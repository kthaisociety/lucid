package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// OIDCConfig is the provider this app signs people in with (docs/adr/0004).
type OIDCConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	// RedirectURL is this app's /auth/callback, exactly as registered with the provider.
	RedirectURL string
	// Domain is the email domain that may sign in, e.g. kthais.com.
	Domain string
	// Google says so: its ID tokens carry `hd`, the Workspace domain, which must be Domain too, and its
	// sign-in page can be limited to Domain's accounts.
	Google bool
	// ExtraScopes are asked for besides openid, email and profile, e.g. Gmail's (docs/adr/0006).
	ExtraScopes []string
	// Offline asks for a refresh token, so the app can act later without the person there. Google then
	// always shows its consent screen.
	Offline bool
}

// OIDC runs the authorization code flow with PKCE: Begin sends the browser to the provider, Finish takes
// the code it comes back with and returns who signed in. Between the two, a short-lived signed cookie per
// sign-in holds its state, nonce and PKCE verifier, so sign-ins in two tabs don't trip each other up.
type OIDC struct {
	cfg      OIDCConfig
	oauth    oauth2.Config
	verifier *oidc.IDTokenVerifier
	key      []byte
	cookie   cookieKind
}

// NewOIDC reads the provider's discovery document, so it needs the provider to be reachable.
func NewOIDC(ctx context.Context, cfg OIDCConfig) (*OIDC, error) {
	provider, err := oidc.NewProvider(ctx, cfg.Issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc provider %s: %w", cfg.Issuer, err)
	}
	return &OIDC{
		cfg: cfg,
		oauth: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			Endpoint:     provider.Endpoint(),
			RedirectURL:  cfg.RedirectURL,
			Scopes:       append([]string{oidc.ScopeOpenID, "email", "profile"}, cfg.ExtraScopes...),
		},
		verifier: provider.Verifier(&oidc.Config{ClientID: cfg.ClientID}),
		key:      flowKey(cfg.ClientSecret, "lucid sign-in flow"),
		cookie:   cookieKindFor(cfg.RedirectURL),
	}, nil
}

// SignInError is why a sign-in was refused. Reason is safe to show; the wrapped error is for the log.
type SignInError struct {
	Reason string
	Err    error
}

func (e *SignInError) Error() string { return e.Reason + ": " + e.Err.Error() }
func (e *SignInError) Unwrap() error { return e.Err }

const (
	// The provider or this app failed, or the flow was tampered with or expired: try again.
	ReasonFailed = "failed"
	// The account isn't one of SIGN_IN_DOMAIN's, or its email isn't verified.
	ReasonDomain = "domain"
	// The account is fine, but not on the team.
	ReasonNotOnTeam = "not-on-team"
)

type flow struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	// For connecting an account: who started it, so it can only finish for them.
	For     string `json:"f,omitempty"`
	Expires int64  `json:"e"`
}

const flowTTL = 10 * time.Minute

// providerTimeout bounds Finish's calls to the provider (the token exchange, and its keys if they
// changed), so a provider that stops answering fails the sign-in instead of holding it open.
var providerTimeout = 15 * time.Second

// flowCookieName is the cookie for the sign-in with this state: part of the state is enough to tell
// sign-ins apart, and Finish still checks the whole of it.
func flowCookieName(state string) string {
	if len(state) > 16 {
		state = state[:16]
	}
	return flowCookie + "_" + state
}

// Begin starts a sign-in: it sets the flow cookie and returns the provider's URL to send the browser to.
// loginHint, if any, is the email the provider suggests.
func (o *OIDC) Begin(w http.ResponseWriter, loginHint string) string {
	f := flow{State: randomString(), Nonce: randomString(), Verifier: oauth2.GenerateVerifier(), Expires: time.Now().Add(flowTTL).Unix()}
	writeFlow(w, o.cookie, o.key, f)

	opts := []oauth2.AuthCodeOption{oidc.Nonce(f.Nonce), oauth2.S256ChallengeOption(f.Verifier)}
	if o.cfg.Google {
		// Google offers only this domain's accounts, and lets someone with several pick one.
		opts = append(opts, oauth2.SetAuthURLParam("hd", o.cfg.Domain), oauth2.SetAuthURLParam("prompt", "select_account"))
	}
	if o.cfg.Offline {
		// A refresh token comes only with the consent screen.
		opts = append(opts, oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("prompt", "consent"))
	}
	if loginHint != "" {
		opts = append(opts, oauth2.SetAuthURLParam("login_hint", loginHint))
	}
	return o.oauth.AuthCodeURL(f.State, opts...)
}

// Finish completes a sign-in from the provider's redirect back to this app, and clears the flow cookie.
func (o *OIDC) Finish(w http.ResponseWriter, r *http.Request) (User, error) {
	u, _, err := o.FinishWithToken(w, r)
	return u, err
}

// FinishWithToken is Finish, also returning the provider's token: its refresh token, and the scopes the
// person actually granted.
func (o *OIDC) FinishWithToken(w http.ResponseWriter, r *http.Request) (User, *oauth2.Token, error) {
	q := r.URL.Query()
	f, err := takeFlow(w, r, o.cookie, o.key)
	if err != nil {
		return User{}, nil, &SignInError{ReasonFailed, err}
	}
	ctx, cancel := context.WithTimeout(r.Context(), providerTimeout)
	defer cancel()
	if e := q.Get("error"); e != "" {
		return User{}, nil, &SignInError{ReasonFailed, fmt.Errorf("provider: %s", e)}
	}

	token, err := o.oauth.Exchange(ctx, q.Get("code"), oauth2.VerifierOption(f.Verifier))
	if err != nil {
		return User{}, nil, &SignInError{ReasonFailed, fmt.Errorf("exchanging the code: %w", err)}
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok {
		return User{}, nil, &SignInError{ReasonFailed, errors.New("no id_token in the token response")}
	}
	// Checks the signature, issuer, audience and expiry.
	idToken, err := o.verifier.Verify(ctx, raw)
	if err != nil {
		return User{}, nil, &SignInError{ReasonFailed, fmt.Errorf("verifying the id_token: %w", err)}
	}
	if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(f.Nonce)) != 1 {
		return User{}, nil, &SignInError{ReasonFailed, errors.New("nonce doesn't match")}
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		HostedDomain  string `json:"hd"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return User{}, nil, &SignInError{ReasonFailed, fmt.Errorf("reading claims: %w", err)}
	}
	email := strings.ToLower(claims.Email)
	domain := strings.ToLower(o.cfg.Domain)
	switch {
	case !claims.EmailVerified:
		return User{}, nil, &SignInError{ReasonDomain, fmt.Errorf("%s isn't verified", email)}
	case !strings.HasSuffix(email, "@"+domain):
		return User{}, nil, &SignInError{ReasonDomain, fmt.Errorf("%s isn't in %s", email, domain)}
	case o.cfg.Google && !strings.EqualFold(claims.HostedDomain, domain):
		return User{}, nil, &SignInError{ReasonDomain, fmt.Errorf("%s isn't a %s Workspace account", email, domain)}
	}
	return User{Subject: idToken.Subject, Email: email, Name: claims.Name}, token, nil
}

// writeFlow sets the cookie that carries a flow from Begin to the provider's redirect back, signed with
// key so the browser can't change it.
func writeFlow(w http.ResponseWriter, cookie cookieKind, key []byte, f flow) {
	payload, _ := json.Marshal(f)
	value := base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(sign(key, payload))
	http.SetCookie(w, cookie.new(flowCookieName(f.State), value, flowTTL))
}

// takeFlow reads and clears the cookie of the flow the provider's redirect names in its state, and checks
// it: signed with key, not expired, and for this very state.
func takeFlow(w http.ResponseWriter, r *http.Request, cookie cookieKind, key []byte) (flow, error) {
	state := r.URL.Query().Get("state")
	name := flowCookieName(state)
	http.SetCookie(w, cookie.clear(name))
	var f flow
	c, err := r.Cookie(cookie.name(name))
	if err != nil {
		return f, errors.New("no sign-in in progress in this browser")
	}
	payload64, sig64, ok := strings.Cut(c.Value, ".")
	payload, err1 := base64.RawURLEncoding.DecodeString(payload64)
	sig, err2 := base64.RawURLEncoding.DecodeString(sig64)
	if !ok || err1 != nil || err2 != nil || !hmac.Equal(sig, sign(key, payload)) {
		return f, errors.New("the sign-in cookie isn't ours")
	}
	if err := json.Unmarshal(payload, &f); err != nil {
		return f, err
	}
	if time.Now().Unix() > f.Expires {
		return f, errors.New("the sign-in took too long")
	}
	if subtle.ConstantTimeCompare([]byte(state), []byte(f.State)) != 1 {
		return f, errors.New("state doesn't match")
	}
	return f, nil
}

func sign(key, payload []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(payload)
	return mac.Sum(nil)
}

// flowKey derives a flow cookie's signing key from a client secret, so there's no other secret to set.
func flowKey(clientSecret, label string) []byte {
	mac := hmac.New(sha256.New, []byte(clientSecret))
	mac.Write([]byte(label))
	return mac.Sum(nil)
}

func randomBytes() []byte {
	b := make([]byte, 32)
	_, _ = rand.Read(b) // crypto/rand.Read never fails
	return b
}

func randomString() string { return base64.RawURLEncoding.EncodeToString(randomBytes()) }

// Client is an HTTP client acting with this refresh token, getting access tokens from the provider as it
// needs them. A grant the person has withdrawn fails its requests with an *oauth2.RetrieveError whose
// ErrorCode is "invalid_grant". Each request, and each token refresh, gives up after providerTimeout.
func (o *OIDC) Client(ctx context.Context, refreshToken string) *http.Client {
	ctx = context.WithValue(ctx, oauth2.HTTPClient, &http.Client{Timeout: providerTimeout})
	c := o.oauth.Client(ctx, &oauth2.Token{RefreshToken: refreshToken})
	c.Timeout = providerTimeout
	return c
}
