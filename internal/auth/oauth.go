package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"time"

	"golang.org/x/oauth2"
)

// OAuthConfig is a provider members connect an account at with plain OAuth 2.0, without signing in
// there: Fathom (docs/adr/0008).
type OAuthConfig struct {
	AuthURL      string
	TokenURL     string
	ClientID     string
	ClientSecret string
	// RedirectURL is this app's callback for it, exactly as registered with the provider.
	RedirectURL string
	Scopes      []string
}

// OAuth runs the authorization code flow: Begin sends the browser to the provider, Finish takes the code
// it comes back with and returns the provider's tokens. Between the two, a short-lived signed cookie per
// attempt holds its state, as for sign-in (docs/adr/0004).
type OAuth struct {
	oauth  oauth2.Config
	key    []byte
	cookie cookieKind
}

func NewOAuth(cfg OAuthConfig) *OAuth {
	return &OAuth{
		oauth: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			// The client's id and secret go in the form, as Fathom's docs send them.
			Endpoint:    oauth2.Endpoint{AuthURL: cfg.AuthURL, TokenURL: cfg.TokenURL, AuthStyle: oauth2.AuthStyleInParams},
			RedirectURL: cfg.RedirectURL,
			Scopes:      cfg.Scopes,
		},
		key:    flowKey(cfg.ClientSecret, "lucid connect flow"),
		cookie: cookieKindFor(cfg.RedirectURL),
	}
}

// Begin starts connecting for the user forWhom (their Subject): it sets the flow cookie and returns the
// provider's URL to send the browser to.
func (o *OAuth) Begin(w http.ResponseWriter, forWhom string) string {
	f := flow{State: randomString(), For: forWhom, Expires: time.Now().Add(flowTTL).Unix()}
	writeFlow(w, o.cookie, o.key, f)
	return o.oauth.AuthCodeURL(f.State)
}

// ErrDenied is the person saying no on the provider's consent screen.
var ErrDenied = errors.New("access wasn't granted")

// ErrSomeoneElse is a connect finishing for a user other than the one who started it: the browser signed
// in as someone else in between. The account isn't connected to either of them.
var ErrSomeoneElse = errors.New("the connect was started by someone else")

// Finish completes connecting from the provider's redirect back to this app, clearing the flow cookie, and
// returns the provider's tokens. forWhom must be who Begin was for; otherwise nothing is exchanged.
func (o *OAuth) Finish(w http.ResponseWriter, r *http.Request, forWhom string) (*oauth2.Token, error) {
	f, err := takeFlow(w, r, o.cookie, o.key)
	if err != nil {
		return nil, err
	}
	if f.For == "" || subtle.ConstantTimeCompare([]byte(f.For), []byte(forWhom)) != 1 {
		return nil, ErrSomeoneElse
	}
	q := r.URL.Query()
	if e := q.Get("error"); e == "access_denied" {
		return nil, ErrDenied
	} else if e != "" {
		return nil, fmt.Errorf("provider: %s", e)
	}
	ctx, cancel := context.WithTimeout(r.Context(), providerTimeout)
	defer cancel()
	token, err := o.oauth.Exchange(o.client(ctx), q.Get("code"))
	if err != nil {
		return nil, fmt.Errorf("exchanging the code: %w", err)
	}
	return token, nil
}

// Refresh trades a refresh token for new tokens. Some providers, Fathom among them, take each refresh
// token once and return a new one with the access token.
func (o *OAuth) Refresh(ctx context.Context, refreshToken string) (*oauth2.Token, error) {
	ctx, cancel := context.WithTimeout(ctx, providerTimeout)
	defer cancel()
	return o.oauth.TokenSource(o.client(ctx), &oauth2.Token{RefreshToken: refreshToken}).Token()
}

// client makes the token calls give up after providerTimeout.
func (o *OAuth) client(ctx context.Context) context.Context {
	return context.WithValue(ctx, oauth2.HTTPClient, &http.Client{Timeout: providerTimeout})
}
