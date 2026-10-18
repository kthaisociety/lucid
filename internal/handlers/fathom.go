package handlers

import (
	"errors"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/kthaisociety/lucid/internal/auth"
	"github.com/kthaisociety/lucid/internal/deals"
	"github.com/kthaisociety/lucid/internal/fathom"
)

// A meeting's summary and action items are larger than anything the app's own forms send.
const maxWebhookBytes = 1 << 20

// registerFathom adds Connect Fathom (docs/adr/0008): the signed-in member connects their own Fathom
// account, and Lucid makes a webhook for their meetings. The callback always ends on the app, with
// ?fathom=<outcome> for it to show.
func registerFathom(r *gin.Engine, api *gin.RouterGroup, oauth *auth.OAuth, sessions *auth.Sessions, conns *fathom.Connections, store *deals.Store) {
	back := func(c *gin.Context, outcome string) {
		c.Redirect(http.StatusFound, "/me?"+url.Values{"fathom": {outcome}}.Encode())
	}
	// Pages the browser opens directly: without a session, back to the app to sign in.
	signedIn := func(c *gin.Context) (auth.User, bool) {
		u, ok, err := sessions.UserOf(c.Request)
		if err != nil {
			_ = c.Error(err)
		}
		if !ok {
			c.Redirect(http.StatusFound, "/")
		}
		return u, ok
	}

	r.GET("/auth/fathom/connect", func(c *gin.Context) {
		if _, ok := signedIn(c); ok {
			c.Redirect(http.StatusFound, oauth.Begin(c.Writer))
		}
	})

	r.GET("/auth/fathom/callback", func(c *gin.Context) {
		u, ok := signedIn(c)
		if !ok {
			return
		}
		token, err := oauth.Finish(c.Writer, c.Request)
		if errors.Is(err, auth.ErrDenied) {
			back(c, "no-access")
			return
		}
		if err == nil {
			err = conns.Connect(c.Request.Context(), u.Subject, token)
		}
		if err != nil {
			log.Printf("connecting %s's Fathom: %v", u.Email, err)
			back(c, "failed")
			return
		}
		back(c, "connected")
	})

	api.DELETE("/fathom", func(c *gin.Context) {
		if err := conns.Disconnect(c.Request.Context(), auth.Current(c).Subject); err != nil {
			fail(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	})

	r.POST("/api/integrations/fathom/:hook", limitBody(maxWebhookBytes), fathomWebhook(conns, store))
}

// fathomWebhook takes a meeting from a member's Fathom webhook (docs/adr/0008). It's outside sign-in:
// the URL names the connection, and its secret's signature is what proves it's Fathom. A meeting with no
// contact on it is acknowledged and dropped.
func fathomWebhook(conns *fathom.Connections, store *deals.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, ok := readBody(c)
		if !ok {
			return
		}
		_, key, err := conns.Hook(c.Request.Context(), c.Param("hook"))
		if errors.Is(err, fathom.ErrUnknownHook) {
			c.JSON(http.StatusNotFound, gin.H{"error": "unknown webhook"})
			return
		}
		if err != nil {
			fail(c, err)
			return
		}
		if err := fathom.Verify(key, c.Request.Header, body, time.Now()); err != nil {
			log.Printf("fathom webhook refused: %v", err)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
			return
		}
		meeting, err := fathom.Parse(body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		recorded, err := store.Record(c.Request.Context(), deals.Touchpoint{
			Type:         "meeting",
			Source:       "fathom",
			ExternalID:   meeting.RecordingID,
			Title:        meeting.Title,
			Body:         meeting.Summary,
			BulletPoints: meeting.ActionItems,
			URL:          meeting.URL,
			OccurredAt:   meeting.StartedAt,
			Emails:       meeting.InviteeEmails,
			By:           meeting.RecordedBy,
		})
		if err != nil {
			fail(c, err)
			return
		}
		if recorded > 0 {
			log.Printf("fathom meeting %s on %d deals", meeting.RecordingID, recorded)
		}
		c.Status(http.StatusNoContent)
	}
}
