// Package config reads every setting from the environment, once, at boot.
package config

import (
	"fmt"
	"os"
	"slices"
	"strings"

	"github.com/kthaisociety/lucid/internal/auth"
	"github.com/kthaisociety/lucid/internal/fathom"
	"github.com/kthaisociety/lucid/internal/gmail"
	"github.com/kthaisociety/lucid/internal/secretbox"
)

type Config struct {
	// Host is the bind address. Empty binds all interfaces, which the container needs. Set it to
	// 127.0.0.1 for local dev: a dev machine with a public IP exposes anything bound to 0.0.0.0.
	Host string
	Port string

	// DatabaseURL is a Postgres connection string, e.g.
	// postgres://crm:crm@127.0.0.1:5436/crm?sslmode=disable.
	DatabaseURL string

	// DevUserEmail, when set, signs every request in as this user, for local work without an OIDC client
	// (docs/pcr/0007). Never set in a deployed environment.
	DevUserEmail string

	// Real sign-in (docs/adr/0004): the provider, this app's client there, where the app is served (its
	// callback is PUBLIC_URL/auth/callback), and the email domain that may sign in.
	OIDCIssuer       string
	OIDCClientID     string
	OIDCClientSecret string
	PublicURL        string
	SignInDomain     string

	// Connect Fathom (docs/adr/0008): the app's OAuth client at Fathom, registered with
	// PUBLIC_URL/auth/fathom/callback. Setting both turns it on; it needs real sign-in and
	// TOKEN_ENCRYPTION_KEY, and an https PUBLIC_URL that Fathom's webhooks can reach. FATHOM_TOKEN_URL
	// overrides where tokens come from, while it's unclear which of Fathom's two works.
	FathomClientID     string
	FathomClientSecret string
	FathomTokenURL     string

	// TokenEncryptionKey seals members' Gmail refresh tokens (docs/adr/0006): 32 random bytes in base64.
	// Setting it turns on Connect Gmail, which needs real sign-in. The Gmail client defaults to the
	// sign-in client while that's Google's; GMAIL_CLIENT_ID and _SECRET set it apart for when sign-in
	// moves to identity-service.
	TokenEncryptionKey string
	GmailClientID      string
	GmailClientSecret  string
}

func Load() *Config {
	return &Config{
		Host:         getEnv("HOST", ""),
		Port:         getEnv("PORT", "8000"),
		DatabaseURL:  getEnv("DATABASE_URL", ""),
		DevUserEmail: strings.TrimSpace(getEnv("DEV_USER_EMAIL", "")),

		OIDCIssuer:       strings.TrimSpace(getEnv("OIDC_ISSUER", "https://accounts.google.com")),
		OIDCClientID:     strings.TrimSpace(getEnv("OIDC_CLIENT_ID", "")),
		OIDCClientSecret: strings.TrimSpace(getEnv("OIDC_CLIENT_SECRET", "")),
		PublicURL:        strings.TrimRight(strings.TrimSpace(getEnv("PUBLIC_URL", "")), "/"),
		SignInDomain:     strings.TrimSpace(getEnv("SIGN_IN_DOMAIN", "kthais.com")),

		FathomClientID:     strings.TrimSpace(getEnv("FATHOM_CLIENT_ID", "")),
		FathomClientSecret: strings.TrimSpace(getEnv("FATHOM_CLIENT_SECRET", "")),
		FathomTokenURL:     strings.TrimSpace(getEnv("FATHOM_TOKEN_URL", fathom.TokenURL)),

		TokenEncryptionKey: strings.TrimSpace(getEnv("TOKEN_ENCRYPTION_KEY", "")),
		GmailClientID:      strings.TrimSpace(getEnv("GMAIL_CLIENT_ID", "")),
		GmailClientSecret:  strings.TrimSpace(getEnv("GMAIL_CLIENT_SECRET", "")),
	}
}

// Gmail is Connect Gmail's settings (docs/adr/0006), or nil when it's off: a Google client asking for
// Gmail, offline, with its own callback.
func (c *Config) Gmail() *auth.OIDCConfig {
	if c.TokenEncryptionKey == "" {
		return nil
	}
	id, secret := c.GmailClientID, c.GmailClientSecret
	if id == "" && secret == "" && c.OIDCIssuer == googleIssuer {
		id, secret = c.OIDCClientID, c.OIDCClientSecret
	}
	if id == "" || secret == "" {
		return nil
	}
	return &auth.OIDCConfig{
		Issuer:       googleIssuer,
		ClientID:     id,
		ClientSecret: secret,
		RedirectURL:  c.PublicURL + "/auth/gmail/callback",
		Domain:       c.SignInDomain,
		Google:       true,
		ExtraScopes:  []string{gmail.Scope},
		Offline:      true,
	}
}

const googleIssuer = "https://accounts.google.com"

// Fathom is Connect Fathom's OAuth client (docs/adr/0008), or nil when it's off.
func (c *Config) Fathom() *auth.OAuthConfig {
	if c.FathomClientID == "" && c.FathomClientSecret == "" {
		return nil
	}
	return &auth.OAuthConfig{
		AuthURL:      fathom.AuthorizeURL,
		TokenURL:     c.FathomTokenURL,
		ClientID:     c.FathomClientID,
		ClientSecret: c.FathomClientSecret,
		RedirectURL:  c.PublicURL + "/auth/fathom/callback",
		Scopes:       []string{fathom.Scope},
	}
}

// OIDC is the real sign-in's settings, or nil when no client is configured and the dev user (if any)
// signs requests in instead.
func (c *Config) OIDC() *auth.OIDCConfig {
	if c.OIDCClientID == "" && c.OIDCClientSecret == "" {
		return nil
	}
	return &auth.OIDCConfig{
		Issuer:       c.OIDCIssuer,
		ClientID:     c.OIDCClientID,
		ClientSecret: c.OIDCClientSecret,
		RedirectURL:  c.PublicURL + "/auth/callback",
		Domain:       c.SignInDomain,
		Google:       c.OIDCIssuer == googleIssuer,
	}
}

// DevUser is the user every request is signed in as, or nil when DEV_USER_EMAIL is unset.
func (c *Config) DevUser() *auth.User {
	if c.DevUserEmail == "" {
		return nil
	}
	return &auth.User{Subject: "dev", Email: c.DevUserEmail, Name: "Dev User"}
}

// Validate fails if a required setting is missing, naming every missing variable at once.
func (c *Config) Validate() error {
	var missing []string
	for name, value := range map[string]string{
		"DATABASE_URL": c.DatabaseURL,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, name)
		}
	}
	if c.OIDC() != nil {
		for name, value := range map[string]string{
			"OIDC_ISSUER":        c.OIDCIssuer,
			"OIDC_CLIENT_ID":     c.OIDCClientID,
			"OIDC_CLIENT_SECRET": c.OIDCClientSecret,
			"PUBLIC_URL":         c.PublicURL,
			"SIGN_IN_DOMAIN":     c.SignInDomain,
		} {
			if value == "" {
				missing = append(missing, name)
			}
		}
	}
	if len(missing) > 0 {
		slices.Sort(missing)
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}
	if c.Fathom() != nil {
		switch {
		case c.FathomClientID == "" || c.FathomClientSecret == "":
			return fmt.Errorf("Connect Fathom needs both FATHOM_CLIENT_ID and FATHOM_CLIENT_SECRET")
		case c.OIDC() == nil || c.TokenEncryptionKey == "":
			return fmt.Errorf("Connect Fathom (FATHOM_CLIENT_ID) needs real sign-in and TOKEN_ENCRYPTION_KEY")
		case !strings.HasPrefix(c.PublicURL, "https://"):
			return fmt.Errorf("Connect Fathom needs an https PUBLIC_URL: Fathom only redirects to https, and posts meetings to it")
		}
	}
	if c.TokenEncryptionKey != "" {
		if _, err := secretbox.New(c.TokenEncryptionKey); err != nil {
			return fmt.Errorf("TOKEN_ENCRYPTION_KEY: %w", err)
		}
		if c.OIDC() == nil {
			return fmt.Errorf("Connect Gmail (TOKEN_ENCRYPTION_KEY) needs real sign-in: set the OIDC client too")
		}
		if c.Gmail() == nil {
			return fmt.Errorf("Connect Gmail needs a Google client: set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET")
		}
	}
	if c.OIDC() != nil && c.DevUserEmail != "" {
		return fmt.Errorf("DEV_USER_EMAIL and an OIDC client are both set: unset DEV_USER_EMAIL to sign in for real (docs/pcr/0007)")
	}
	if c.OIDC() != nil && !strings.HasPrefix(c.PublicURL, "https://") && !isLoopback(c.PublicURL) {
		return fmt.Errorf("PUBLIC_URL must be https, or http on 127.0.0.1 or localhost for local work")
	}
	return nil
}

func isLoopback(url string) bool {
	return strings.HasPrefix(url, "http://127.0.0.1:") || strings.HasPrefix(url, "http://localhost:") ||
		url == "http://127.0.0.1" || url == "http://localhost"
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
