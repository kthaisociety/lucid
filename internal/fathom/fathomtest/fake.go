// Package fathomtest is a fake Fathom for tests (docs/adr/0008): a real HTTP server with OAuth's authorize
// and token endpoints, and the webhooks API. It checks what it's asked like Fathom: the client's id and
// secret, each code and each refresh token used once, and a valid access token on API calls.
package fathomtest

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/kthaisociety/lucid/internal/fathom"
)

const (
	ClientID     = "fathom-test-client"
	ClientSecret = "fathom-test-secret"
)

// Webhook is one the app made, as Fathom keeps it.
type Webhook struct {
	ID                 string
	Destination        string   `json:"destination_url"`
	TriggeredFor       []string `json:"triggered_for"`
	IncludeSummary     bool     `json:"include_summary"`
	IncludeActionItems bool     `json:"include_action_items"`
	Secret             string
	// Key signs deliveries, as Fathom does with the secret.
	Key []byte
}

type Fake struct {
	*httptest.Server
	t *testing.T

	mu       sync.Mutex
	deny     bool
	codes    map[string]string // code → redirect_uri it was issued for
	access   map[string]bool   // valid access tokens
	refresh  map[string]bool   // refresh tokens: true until used
	webhooks map[string]*Webhook
	// Deleted is the ids of webhooks the app deleted, in order.
	Deleted []string
	// LastAuthorize is the query of the latest authorize request.
	LastAuthorize url.Values
	// Down makes the API (not OAuth) answer 500.
	Down bool
}

// New starts a fake Fathom and points the fathom package's URLs at it until the test ends. Its token URL
// is TokenURL().
func New(t *testing.T) *Fake {
	f := &Fake{t: t, codes: map[string]string{}, access: map[string]bool{}, refresh: map[string]bool{}, webhooks: map[string]*Webhook{}}
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.Close)
	authorize, api := fathom.AuthorizeURL, fathom.API
	fathom.AuthorizeURL, fathom.API = f.URL+"/oauth2/authorize", f.URL
	t.Cleanup(func() { fathom.AuthorizeURL, fathom.API = authorize, api })
	return f
}

func (f *Fake) TokenURL() string { return f.URL + "/oauth2/token" }

// Denies makes the next consent screen answer "no".
func (f *Fake) Denies() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deny = true
}

// Webhooks is the webhooks Fathom has now.
func (f *Fake) Webhooks() []Webhook {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []Webhook
	for _, w := range f.webhooks {
		out = append(out, *w)
	}
	return out
}

// RefreshTokens counts the refresh tokens Fathom has issued: not yet traded in, and traded in.
func (f *Fake) RefreshTokens() (unused, used int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, fresh := range f.refresh {
		if fresh {
			unused++
		} else {
			used++
		}
	}
	return unused, used
}

func random(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + base64.RawURLEncoding.EncodeToString(b)
}

func (f *Fake) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case r.URL.Path == "/oauth2/authorize":
		f.authorize(w, r)
	case r.URL.Path == "/oauth2/token":
		f.token(w, r)
	case strings.HasPrefix(r.URL.Path, "/webhooks"):
		if !f.access[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")] {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		if f.Down {
			http.Error(w, "down", http.StatusInternalServerError)
			return
		}
		f.webhook(w, r)
	default:
		http.NotFound(w, r)
	}
}

// authorize is the consent screen, answered at once: a code back to the app, or "no".
func (f *Fake) authorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f.LastAuthorize = q
	back, err := url.Parse(q.Get("redirect_uri"))
	if err != nil || q.Get("client_id") != ClientID || q.Get("response_type") != "code" || q.Get("scope") != fathom.Scope {
		http.Error(w, "bad authorize request", http.StatusBadRequest)
		return
	}
	answer := url.Values{"state": {q.Get("state")}}
	if f.deny {
		f.deny = false
		answer.Set("error", "access_denied")
	} else {
		code := random("code-")
		f.codes[code] = q.Get("redirect_uri")
		answer.Set("code", code)
	}
	back.RawQuery = answer.Encode()
	http.Redirect(w, r, back.String(), http.StatusFound)
}

func (f *Fake) token(w http.ResponseWriter, r *http.Request) {
	if r.FormValue("client_id") != ClientID || r.FormValue("client_secret") != ClientSecret {
		oauthError(w, "invalid_client")
		return
	}
	switch r.FormValue("grant_type") {
	case "authorization_code":
		code := r.FormValue("code")
		redirect, ok := f.codes[code]
		delete(f.codes, code)
		if !ok || redirect != r.FormValue("redirect_uri") {
			oauthError(w, "invalid_grant")
			return
		}
	case "refresh_token":
		token := r.FormValue("refresh_token")
		if !f.refresh[token] {
			oauthError(w, "invalid_grant") // unknown, or used already
			return
		}
		f.refresh[token] = false
	default:
		oauthError(w, "unsupported_grant_type")
		return
	}
	access, refresh := random("access-"), random("refresh-")
	f.access[access], f.refresh[refresh] = true, true
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"access_token": access, "refresh_token": refresh, "expires_in": 3600, "token_type": "Bearer"})
}

func oauthError(w http.ResponseWriter, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}

func (f *Fake) webhook(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost && r.URL.Path == "/webhooks" {
		var hook Webhook
		if err := json.NewDecoder(r.Body).Decode(&hook); err != nil || hook.Destination == "" || len(hook.TriggeredFor) == 0 {
			http.Error(w, "bad webhook", http.StatusBadRequest)
			return
		}
		hook.ID = random("hook-")
		hook.Key = []byte(random("key-"))
		hook.Secret = "whsec_" + base64.StdEncoding.EncodeToString(hook.Key)
		f.webhooks[hook.ID] = &hook
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": hook.ID, "url": hook.Destination, "secret": hook.Secret})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/webhooks/")
	if r.Method != http.MethodDelete || id == r.URL.Path {
		http.NotFound(w, r)
		return
	}
	if _, ok := f.webhooks[id]; !ok {
		http.NotFound(w, r)
		return
	}
	delete(f.webhooks, id)
	f.Deleted = append(f.Deleted, id)
	w.WriteHeader(http.StatusNoContent)
}
