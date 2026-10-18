package handlers

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kthaisociety/lucid/internal/auth"
	"github.com/kthaisociety/lucid/internal/auth/authtest"
	"github.com/kthaisociety/lucid/internal/database/databasetest"
	"github.com/kthaisociety/lucid/internal/deals"
	"github.com/kthaisociety/lucid/internal/fathom"
	"github.com/kthaisociety/lucid/internal/fathom/fathomtest"
	"github.com/kthaisociety/lucid/internal/secretbox"
)

// Connect Fathom (docs/adr/0008), against a fake Fathom, with real sign-in against the fake Google. The
// meeting payload names Lina Dahl at granit.example and Maja Holm from the team.

type fathomApp struct {
	*signInApp
	fathom *fathomtest.Fake
}

func newFathomApp(t *testing.T) *fathomApp {
	gin.SetMode(gin.TestMode)
	provider := authtest.NewProvider(t)
	oidc, err := auth.NewOIDC(context.Background(), auth.OIDCConfig{
		Issuer: provider.URL, ClientID: authtest.ClientID, ClientSecret: authtest.ClientSecret,
		RedirectURL: "http://127.0.0.1:5174/auth/callback", Domain: "example.com", Google: true,
	})
	require.NoError(t, err)
	fake := fathomtest.New(t)
	oauth := auth.NewOAuth(auth.OAuthConfig{
		AuthURL: fathom.AuthorizeURL, TokenURL: fake.TokenURL(), ClientID: fathomtest.ClientID, ClientSecret: fathomtest.ClientSecret,
		RedirectURL: "http://127.0.0.1:5174/auth/fathom/callback", Scopes: []string{fathom.Scope},
	})
	box, err := secretbox.New("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	require.NoError(t, err)
	db := databasetest.Open(t)
	store := deals.NewStore(db).OnlyTeamMembers()
	router := NewRouter(Deps{
		PingDB:      func(context.Context) error { return nil },
		Frontend:    builtUI,
		OIDC:        oidc,
		Sessions:    auth.NewSessions(db, "http://127.0.0.1:5174"),
		Deals:       store,
		FathomOAuth: oauth,
		Fathom:      fathom.NewConnections(db, box, oauth, "https://lucid.example"),
	})
	return &fathomApp{signInApp: &signInApp{router: router, provider: provider, store: store, db: db}, fathom: fake}
}

// connectFathom signs Maja in and connects her Fathom, returning her browser and the webhook Fathom made.
func connectFathom(t *testing.T, app *fathomApp) (*browser, fathomtest.Webhook) {
	t.Helper()
	b := signedInAsMaja(t, app.signInApp)
	require.Equal(t, "/me?fathom=connected", b.through("/auth/fathom/connect", "/auth/fathom/callback", maja()))
	hooks := app.fathom.Webhooks()
	require.Len(t, hooks, 1)
	return b, hooks[0]
}

// postMeeting delivers a meeting the way Fathom does: to the webhook's URL, signed with key.
func postMeeting(r http.Handler, hook fathomtest.Webhook, body []byte, key []byte) *httptest.ResponseRecorder {
	target, _ := url.Parse(hook.Destination)
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	req := httptest.NewRequest(http.MethodPost, target.Path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("webhook-id", "msg_test")
	req.Header.Set("webhook-timestamp", stamp)
	req.Header.Set("webhook-signature", "v1,"+fathom.Sign(key, "msg_test", stamp, body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func fathomState(t *testing.T, b *browser) string {
	t.Helper()
	return decode[map[string]any](t, b.do(http.MethodGet, "/api/me"))["fathom"].(string)
}

func meetingPayload(t *testing.T) []byte {
	t.Helper()
	body, err := os.ReadFile("../fathom/testdata/meeting.json")
	require.NoError(t, err)
	return body
}

// lead adds a deal at the company, with Lina as its contact when the company is Granit. Maja adds it, so
// she must be on the team.
func lead(t *testing.T, store *deals.Store, company, semester string) deals.View {
	t.Helper()
	in := deals.NewLead{Company: company, DealType: "Event", Semester: semester}
	if company == "Granit Consulting" {
		in.Contact = &deals.ContactInput{Name: "Lina Dahl", Email: "lina.dahl@granit.example"}
	}
	v, err := store.Create(context.Background(), in, auth.User{Subject: "maja", Email: "maja@example.com", Name: "Maja Holm"})
	require.NoError(t, err)
	return v
}

func setStatus(t *testing.T, store *deals.Store, id, status string) {
	t.Helper()
	_, err := store.Update(context.Background(), id, map[string]any{"status": status})
	require.NoError(t, err)
}

func meetingsOn(t *testing.T, store *deals.Store, id string) []deals.ActivityView {
	t.Helper()
	v, err := store.Get(context.Background(), id)
	require.NoError(t, err)
	var meetings []deals.ActivityView
	for _, a := range v.Activities {
		if a.Type == "meeting" {
			meetings = append(meetings, a)
		}
	}
	return meetings
}

func TestAMemberConnectsTheirFathom(t *testing.T) {
	app := newFathomApp(t)
	b := signedInAsMaja(t, app.signInApp)
	assert.Equal(t, "not-connected", fathomState(t, b))

	assert.Equal(t, "/me?fathom=connected", b.through("/auth/fathom/connect", "/auth/fathom/callback", maja()))

	asked := app.fathom.LastAuthorize
	assert.Equal(t, fathom.Scope, asked.Get("scope"))
	assert.Equal(t, "http://127.0.0.1:5174/auth/fathom/callback", asked.Get("redirect_uri"))
	assert.Equal(t, "connected", fathomState(t, b))

	hooks := app.fathom.Webhooks()
	require.Len(t, hooks, 1)
	hook := hooks[0]
	assert.Regexp(t, `^https://lucid\.example/api/integrations/fathom/[A-Za-z0-9_-]{32}$`, hook.Destination)
	assert.Equal(t, []string{"my_recordings", "my_shared_with_team_recordings"}, hook.TriggeredFor)
	assert.True(t, hook.IncludeSummary)
	assert.True(t, hook.IncludeActionItems)

	var stored struct{ RefreshToken, WebhookSecret []byte }
	require.NoError(t, app.db.Raw("SELECT refresh_token, webhook_secret FROM fathom_connections").Scan(&stored).Error)
	require.NotEmpty(t, stored.RefreshToken)
	assert.NotContains(t, string(stored.RefreshToken), "refresh-", "the token is stored sealed")
	assert.NotContains(t, string(stored.WebhookSecret), "whsec_", "and so is the webhook's secret")

	for _, m := range decode[[]deals.MemberView](t, b.do(http.MethodGet, "/api/members")) {
		require.NotNil(t, m.FathomConnected)
		assert.True(t, *m.FathomConnected)
	}
}

func TestSayingNoConnectsNothing(t *testing.T) {
	app := newFathomApp(t)
	b := signedInAsMaja(t, app.signInApp)
	app.fathom.Denies()

	assert.Equal(t, "/me?fathom=no-access", b.through("/auth/fathom/connect", "/auth/fathom/callback", maja()))

	assert.Equal(t, "not-connected", fathomState(t, b))
	assert.Empty(t, app.fathom.Webhooks())
}

func TestConnectingFathomNeedsASessionAndItsOwnFlow(t *testing.T) {
	app := newFathomApp(t)

	w := app.browser(t).do(http.MethodGet, "/auth/fathom/connect")
	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "/", w.Header().Get("Location"), "signed out: to the app, to sign in")

	// A callback this browser didn't start (a forged link, say) connects nothing.
	b := signedInAsMaja(t, app.signInApp)
	w = b.do(http.MethodGet, "/auth/fathom/callback?code=stolen&state=made-up")
	assert.Equal(t, "/me?fathom=failed", w.Header().Get("Location"))
	assert.Equal(t, "not-connected", fathomState(t, b))
}

func TestWhenFathomCantMakeTheWebhookNothingIsConnected(t *testing.T) {
	app := newFathomApp(t)
	b := signedInAsMaja(t, app.signInApp)
	app.fathom.Down = true

	assert.Equal(t, "/me?fathom=failed", b.through("/auth/fathom/connect", "/auth/fathom/callback", maja()))

	assert.Equal(t, "not-connected", fathomState(t, b))
}

func TestDisconnectingDeletesTheWebhook(t *testing.T) {
	app := newFathomApp(t)
	b, hook := connectFathom(t, app)
	open := lead(t, app.store, "Granit Consulting", "HT 2026")

	assert.Equal(t, http.StatusNoContent, b.do(http.MethodDelete, "/api/fathom").Code)

	assert.Equal(t, "not-connected", fathomState(t, b))
	assert.Equal(t, []string{hook.ID}, app.fathom.Deleted)
	unused, used := app.fathom.RefreshTokens()
	assert.Equal(t, 1, used, "the stored refresh token was traded for an access token")
	assert.Equal(t, 1, unused, "and the new one dropped")
	assert.Equal(t, http.StatusNotFound, postMeeting(app.router, hook, meetingPayload(t), hook.Key).Code)
	assert.Empty(t, meetingsOn(t, app.store, open.ID))
	assert.Equal(t, http.StatusNoContent, b.do(http.MethodDelete, "/api/fathom").Code, "twice is fine")
}

func TestDisconnectingWorksWhenFathomIsDown(t *testing.T) {
	app := newFathomApp(t)
	b, hook := connectFathom(t, app)
	app.fathom.Down = true

	assert.Equal(t, http.StatusNoContent, b.do(http.MethodDelete, "/api/fathom").Code)

	assert.Equal(t, "not-connected", fathomState(t, b))
	assert.Equal(t, http.StatusNotFound, postMeeting(app.router, hook, meetingPayload(t), hook.Key).Code)
}

func TestConnectingAgainReplacesTheWebhook(t *testing.T) {
	app := newFathomApp(t)
	b, first := connectFathom(t, app)

	require.Equal(t, "/me?fathom=connected", b.through("/auth/fathom/connect", "/auth/fathom/callback", maja()))

	hooks := app.fathom.Webhooks()
	require.Len(t, hooks, 1)
	assert.NotEqual(t, first.ID, hooks[0].ID)
	assert.Equal(t, []string{first.ID}, app.fathom.Deleted)
	assert.Equal(t, http.StatusNotFound, postMeeting(app.router, first, meetingPayload(t), first.Key).Code)
	open := lead(t, app.store, "Granit Consulting", "HT 2026")
	assert.Equal(t, http.StatusNoContent, postMeeting(app.router, hooks[0], meetingPayload(t), hooks[0].Key).Code)
	assert.Len(t, meetingsOn(t, app.store, open.ID), 1)
}

func TestRemovingAMemberRemovesTheirConnection(t *testing.T) {
	app := newFathomApp(t)
	_, hook := connectFathom(t, app)
	var id string
	require.NoError(t, app.db.Raw("SELECT member_id FROM fathom_connections").Scan(&id).Error)

	require.NoError(t, app.store.RemoveMember(context.Background(), id))

	assert.Equal(t, http.StatusNotFound, postMeeting(app.router, hook, meetingPayload(t), hook.Key).Code)
}

func TestAFathomMeetingLandsOnTheContactsOpenDeals(t *testing.T) {
	app := newFathomApp(t)
	_, hook := connectFathom(t, app)
	r, store := app.router, app.store
	first := lead(t, store, "Granit Consulting", "HT 2026")
	second := lead(t, store, "Granit Consulting", "VT 2027")
	done := lead(t, store, "Granit Consulting", "HT 2025")
	setStatus(t, store, done.ID, "finished")
	other := lead(t, store, "Polar Systems", "HT 2026")

	w := postMeeting(r, hook, meetingPayload(t), hook.Key)

	require.Equal(t, http.StatusNoContent, w.Code, w.Body.String())
	for _, id := range []string{first.ID, second.ID} {
		meetings := meetingsOn(t, store, id)
		require.Len(t, meetings, 1)
		m := meetings[0]
		assert.Equal(t, "fathom", m.Source)
		assert.Equal(t, "Lunch lecture planning", m.Title)
		assert.Equal(t, "2026-10-14T14:01:12Z", m.Timestamp)
		assert.Contains(t, m.Body, "We agreed on a lunch lecture on 4 Dec")
		assert.Equal(t, []string{"Send the invoice with 30-day terms"}, m.BulletPoints)
		assert.Equal(t, "https://fathom.video/share/abc123", m.URL)
	}
	assert.Empty(t, meetingsOn(t, store, done.ID), "a finished deal doesn't get it while others are open")
	assert.Empty(t, meetingsOn(t, store, other.ID), "nor does another company's")

	// Fathom resends a webhook it thinks failed: still one meeting.
	require.Equal(t, http.StatusNoContent, postMeeting(r, hook, meetingPayload(t), hook.Key).Code)
	assert.Len(t, meetingsOn(t, store, first.ID), 1)

	// The summary is written again in Fathom and sent again: it replaces the old one, still once.
	rewritten := bytes.Replace(meetingPayload(t), []byte("We agreed on a"), []byte("We settled on a"), 1)
	require.Equal(t, http.StatusNoContent, postMeeting(r, hook, rewritten, hook.Key).Code)
	meetings := meetingsOn(t, store, first.ID)
	require.Len(t, meetings, 1)
	assert.Contains(t, meetings[0].Body, "We settled on a lunch lecture")
}

func TestWithNoOpenDealTheMeetingLandsOnTheLatest(t *testing.T) {
	app := newFathomApp(t)
	_, hook := connectFathom(t, app)
	older := lead(t, app.store, "Granit Consulting", "HT 2025")
	newer := lead(t, app.store, "Granit Consulting", "VT 2026")
	setStatus(t, app.store, older.ID, "finished")
	setStatus(t, app.store, newer.ID, "canceled")

	require.Equal(t, http.StatusNoContent, postMeeting(app.router, hook, meetingPayload(t), hook.Key).Code)

	assert.Len(t, meetingsOn(t, app.store, newer.ID), 1)
	assert.Empty(t, meetingsOn(t, app.store, older.ID))
}

func TestAMeetingWithNoContactIsDropped(t *testing.T) {
	app := newFathomApp(t)
	_, hook := connectFathom(t, app)
	other := lead(t, app.store, "Polar Systems", "HT 2026")

	require.Equal(t, http.StatusNoContent, postMeeting(app.router, hook, meetingPayload(t), hook.Key).Code)

	assert.Empty(t, meetingsOn(t, app.store, other.ID))
}

func TestOnlyFathomCanPostMeetings(t *testing.T) {
	app := newFathomApp(t)
	_, hook := connectFathom(t, app)
	open := lead(t, app.store, "Granit Consulting", "HT 2026")

	w := postMeeting(app.router, hook, meetingPayload(t), []byte("someone else's key"))

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Empty(t, meetingsOn(t, app.store, open.ID))
	assert.Equal(t, http.StatusBadRequest, postMeeting(app.router, hook, []byte(`{"title":"no id"}`), hook.Key).Code)

	// Another member's webhook secret doesn't sign for this one, nor does a made-up URL exist.
	unknown := fathomtest.Webhook{Destination: "https://lucid.example/api/integrations/fathom/made-up"}
	assert.Equal(t, http.StatusNotFound, postMeeting(app.router, unknown, meetingPayload(t), hook.Key).Code)
}

func TestWithoutFathomTheWebhooksAreOff(t *testing.T) {
	r := newTestRouter(builtUI)
	hook := fathomtest.Webhook{Destination: "https://lucid.example/api/integrations/fathom/anything"}
	assert.Equal(t, http.StatusNotFound, postMeeting(r, hook, meetingPayload(t), []byte("key")).Code)
}

// Connecting again while an admin removes the member: the connect waits for the removal and then fails,
// instead of the two waiting on each other (removal locks the member, then deletes the connection).
func TestConnectingWhileBeingRemovedWaitsForTheRemoval(t *testing.T) {
	app := newFathomApp(t)
	b, first := connectFathom(t, app)
	var id string
	require.NoError(t, app.db.Raw("SELECT member_id FROM fathom_connections").Scan(&id).Error)

	// Fathom has said yes; the callback is about to arrive.
	w := b.do(http.MethodGet, "/auth/fathom/connect")
	noFollow := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := noFollow.Get(w.Header().Get("Location"))
	require.NoError(t, err)
	resp.Body.Close()
	callback, err := url.Parse(resp.Header.Get("Location"))
	require.NoError(t, err)

	removal := app.db.Begin()
	defer removal.Rollback()
	require.NoError(t, removal.Exec("SELECT 1 FROM members WHERE id = ? FOR UPDATE", id).Error)
	done := make(chan string, 1)
	go func() { done <- b.do(http.MethodGet, callback.RequestURI()).Header().Get("Location") }()
	require.Eventually(t, func() bool {
		var waiting int64
		app.db.Raw("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()").Scan(&waiting)
		return waiting > 0
	}, 5*time.Second, 10*time.Millisecond, "the connect waits for the removal")
	require.NoError(t, removal.Exec("DELETE FROM members WHERE id = ?", id).Error)
	require.NoError(t, removal.Commit().Error)

	assert.Equal(t, "/me?fathom=failed", <-done)
	hooks := app.fathom.Webhooks()
	require.Len(t, hooks, 1, "the new webhook is taken down again")
	assert.Equal(t, first.ID, hooks[0].ID)
}
