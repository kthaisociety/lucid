package fathom

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"golang.org/x/oauth2"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/kthaisociety/lucid/internal/secretbox"
)

// Refresher trades a refresh token for new tokens: the app's Fathom OAuth client (auth.OAuth).
type Refresher interface {
	Refresh(ctx context.Context, refreshToken string) (*oauth2.Token, error)
}

// Connections are members' connected Fathom accounts (docs/adr/0008): each one's sealed refresh token,
// and the webhook Fathom posts their meetings with.
type Connections struct {
	db        *gorm.DB
	box       *secretbox.Box
	oauth     Refresher
	client    *http.Client
	publicURL string
}

// NewConnections keeps connections in db, sealed with box. publicURL is where Fathom reaches this app:
// each member's webhook posts to publicURL/api/integrations/fathom/<hook>.
func NewConnections(db *gorm.DB, box *secretbox.Box, oauth Refresher, publicURL string) *Connections {
	return &Connections{db: db, box: box, oauth: oauth, client: &http.Client{Timeout: 15 * time.Second}, publicURL: publicURL}
}

type connection struct {
	MemberID      string `gorm:"primaryKey"`
	RefreshToken  []byte
	Hook          string
	WebhookID     string
	WebhookSecret []byte
	ConnectedAt   time.Time `gorm:"default:now()"`
}

func (connection) TableName() string { return "fathom_connections" }

// WebhookPath is where a connection's webhook posts, under the app's public URL.
func WebhookPath(hook string) string { return "/api/integrations/fathom/" + hook }

// Connect stores a member's connection from the tokens Fathom gave on their consent, and makes the webhook
// that brings in their meetings. A connection they had before is replaced, and its webhook deleted.
func (c *Connections) Connect(ctx context.Context, memberID string, token *oauth2.Token) error {
	if token.AccessToken == "" || token.RefreshToken == "" {
		return errors.New("fathom gave no access or refresh token")
	}
	hook := randomHook()
	webhook, err := CreateWebhook(ctx, c.client, token.AccessToken, c.publicURL+WebhookPath(hook))
	if err != nil {
		return err
	}
	row := connection{
		MemberID: memberID, RefreshToken: c.box.Seal([]byte(token.RefreshToken)), Hook: hook,
		WebhookID: webhook.ID, WebhookSecret: c.box.Seal([]byte(webhook.Secret)), ConnectedAt: time.Now(),
	}
	var old *connection
	err = c.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The member first, as removing a member locks them first and then deletes their connection:
		// the other way round, the two could wait on each other. The lock holds off the removal, and
		// another connect for the same member, which would otherwise not see this one's connection and
		// leave its webhook behind.
		var members []string
		if err := tx.Raw("SELECT id FROM members WHERE id = ? FOR NO KEY UPDATE", memberID).Scan(&members).Error; err != nil {
			return err
		}
		if len(members) == 0 {
			return ErrNotOnTeam
		}
		var before connection
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("member_id = ?", memberID).Take(&before).Error
		if err == nil {
			old = &before
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "member_id"}}, UpdateAll: true}).Create(&row).Error
	})
	if err != nil {
		// Nothing points at the new webhook: take it down again.
		if derr := DeleteWebhook(ctx, c.client, token.AccessToken, webhook.ID); derr != nil {
			log.Printf("fathom: removing an unused webhook: %v", derr)
		}
		return fmt.Errorf("saving the connection: %w", err)
	}
	if old != nil {
		c.removeWebhook(ctx, *old)
	}
	return nil
}

// Connected says whether the member has connected their Fathom.
func (c *Connections) Connected(ctx context.Context, memberID string) (bool, error) {
	var n int64
	err := c.db.WithContext(ctx).Model(&connection{}).Where("member_id = ?", memberID).Count(&n).Error
	return n > 0, err
}

// ConnectedMembers is the ids of members with a connected Fathom, for the Team page.
func (c *Connections) ConnectedMembers(ctx context.Context) (map[string]bool, error) {
	var ids []string
	if err := c.db.WithContext(ctx).Model(&connection{}).Pluck("member_id", &ids).Error; err != nil {
		return nil, err
	}
	connected := make(map[string]bool, len(ids))
	for _, id := range ids {
		connected[id] = true
	}
	return connected, nil
}

// Disconnect forgets the member's connection, then deletes its webhook at Fathom. The connection is gone
// from the CRM even if Fathom can't be reached; deliveries to its webhook then get 404.
func (c *Connections) Disconnect(ctx context.Context, memberID string) error {
	var rows []connection
	err := c.db.WithContext(ctx).Clauses(clause.Returning{}).Where("member_id = ?", memberID).Delete(&rows).Error
	if err != nil {
		return err
	}
	for _, row := range rows {
		c.removeWebhook(ctx, row)
	}
	return nil
}

// ErrNotOnTeam is a member removed from the team while they were connecting.
var ErrNotOnTeam = errors.New("no longer on the team")

// ErrUnknownHook is a delivery to a webhook URL no connection has: never made, or disconnected.
var ErrUnknownHook = errors.New("no Fathom connection has this webhook")

// Hook is the connection a delivery came to: its member, and the key its webhook signs with.
func (c *Connections) Hook(ctx context.Context, hook string) (memberID string, key []byte, err error) {
	var row connection
	err = c.db.WithContext(ctx).Where("hook = ?", hook).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil, ErrUnknownHook
	}
	if err != nil {
		return "", nil, err
	}
	secret, err := c.box.Open(row.WebhookSecret)
	if err != nil {
		return "", nil, fmt.Errorf("opening the webhook secret: %w", err)
	}
	key, err = Key(string(secret))
	return row.MemberID, key, err
}

// removeWebhook deletes a forgotten connection's webhook at Fathom, with an access token from its refresh
// token. Fathom takes each refresh token once; the one it returns is dropped with the connection. Failing
// is logged, not returned: the connection is already gone.
func (c *Connections) removeWebhook(ctx context.Context, row connection) {
	refresh, err := c.box.Open(row.RefreshToken)
	if err != nil {
		log.Printf("fathom: can't open a token to delete webhook %s: %v", row.WebhookID, err)
		return
	}
	token, err := c.oauth.Refresh(ctx, string(refresh))
	if err != nil {
		log.Printf("fathom: no access token to delete webhook %s: %v", row.WebhookID, err)
		return
	}
	if err := DeleteWebhook(ctx, c.client, token.AccessToken, row.WebhookID); err != nil {
		log.Printf("fathom: %v", err)
	}
}

// randomHook is a webhook URL's last segment: random, so nobody can guess another member's.
func randomHook() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b) // crypto/rand.Read never fails
	return base64.RawURLEncoding.EncodeToString(b)
}
