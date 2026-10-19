package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setRequired(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
}

func TestNoDevUserByDefault(t *testing.T) {
	setRequired(t)
	t.Setenv("DEV_USER_EMAIL", "")

	assert.Nil(t, Load().DevUser())
}

func TestDevUserFromEnv(t *testing.T) {
	setRequired(t)
	t.Setenv("DEV_USER_EMAIL", " dev@kthais.com ")

	u := Load().DevUser()
	require.NotNil(t, u)
	assert.Equal(t, "dev@kthais.com", u.Email)
}

func setOIDC(t *testing.T) {
	t.Setenv("OIDC_CLIENT_ID", "client")
	t.Setenv("OIDC_CLIENT_SECRET", "secret")
	t.Setenv("PUBLIC_URL", "https://crm.example.com/")
	t.Setenv("DEV_USER_EMAIL", "")
}

func TestNoOIDCWithoutAClient(t *testing.T) {
	setRequired(t)

	assert.Nil(t, Load().OIDC())
}

func TestOIDCFromEnv(t *testing.T) {
	setRequired(t)
	setOIDC(t)

	cfg := Load()
	require.NoError(t, cfg.Validate())
	o := cfg.OIDC()
	require.NotNil(t, o)
	assert.Equal(t, "https://accounts.google.com", o.Issuer)
	assert.Equal(t, "https://crm.example.com/auth/callback", o.RedirectURL)
	assert.Equal(t, "kthais.com", o.Domain)
	assert.True(t, o.Google)
}

func TestOIDCNeedsTheWholeClientAndAPublicURL(t *testing.T) {
	setRequired(t)
	t.Setenv("OIDC_CLIENT_ID", "client")

	err := Load().Validate()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "OIDC_CLIENT_SECRET, PUBLIC_URL")
}

func TestOIDCAndTheDevUserDontMix(t *testing.T) {
	setRequired(t)
	setOIDC(t)
	t.Setenv("DEV_USER_EMAIL", "dev@kthais.com")

	assert.ErrorContains(t, Load().Validate(), "DEV_USER_EMAIL")
}

func TestOIDCNeedsHTTPSExceptOnThisMachine(t *testing.T) {
	setRequired(t)
	setOIDC(t)
	t.Setenv("PUBLIC_URL", "http://crm.example.com")
	assert.ErrorContains(t, Load().Validate(), "PUBLIC_URL must be https")

	t.Setenv("PUBLIC_URL", "http://127.0.0.1:5174")
	assert.NoError(t, Load().Validate())
}

func TestFathomIsOffWithoutAClient(t *testing.T) {
	setRequired(t)
	setOIDC(t)

	assert.Nil(t, Load().Fathom())
	assert.NoError(t, Load().Validate())
}

func TestFathomFromEnv(t *testing.T) {
	setRequired(t)
	setOIDC(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testTokenKey)
	t.Setenv("FATHOM_CLIENT_ID", " fathom-client ")
	t.Setenv("FATHOM_CLIENT_SECRET", "fathom-secret")

	cfg := Load()
	require.NoError(t, cfg.Validate())
	f := cfg.Fathom()
	require.NotNil(t, f)
	assert.Equal(t, "fathom-client", f.ClientID)
	assert.Equal(t, "https://crm.example.com/auth/fathom/callback", f.RedirectURL)
	assert.Equal(t, "https://api.fathom.ai/external/v1/oauth2/token", f.TokenURL)
	assert.Equal(t, []string{"public_api"}, f.Scopes)

	t.Setenv("FATHOM_TOKEN_URL", "https://fathom.video/external/v1/oauth2/token")
	assert.Equal(t, "https://fathom.video/external/v1/oauth2/token", Load().Fathom().TokenURL)
}

func TestFathomNeedsItsWholeClientRealSignInAKeyAndHTTPS(t *testing.T) {
	setRequired(t)
	setOIDC(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testTokenKey)
	t.Setenv("FATHOM_CLIENT_ID", "fathom-client")
	assert.ErrorContains(t, Load().Validate(), "both FATHOM_CLIENT_ID and FATHOM_CLIENT_SECRET")

	t.Setenv("FATHOM_CLIENT_SECRET", "fathom-secret")
	t.Setenv("TOKEN_ENCRYPTION_KEY", "")
	assert.ErrorContains(t, Load().Validate(), "needs real sign-in and TOKEN_ENCRYPTION_KEY")

	t.Setenv("TOKEN_ENCRYPTION_KEY", testTokenKey)
	t.Setenv("PUBLIC_URL", "http://127.0.0.1:8002")
	assert.ErrorContains(t, Load().Validate(), "https PUBLIC_URL", "Fathom can't redirect to or post to a laptop's http")

	t.Setenv("PUBLIC_URL", "https://example.ngrok-free.dev")
	assert.NoError(t, Load().Validate())

	t.Setenv("OIDC_CLIENT_ID", "")
	t.Setenv("OIDC_CLIENT_SECRET", "")
	t.Setenv("DEV_USER_EMAIL", "dev@kthais.com")
	assert.ErrorContains(t, Load().Validate(), "needs real sign-in", "never the dev user behind a tunnel")
}

const testTokenKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="

func TestGmailIsOffWithoutAKey(t *testing.T) {
	setRequired(t)
	setOIDC(t)

	assert.Nil(t, Load().Gmail())
}

func TestGmailUsesTheGoogleSignInClient(t *testing.T) {
	setRequired(t)
	setOIDC(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testTokenKey)

	cfg := Load()
	require.NoError(t, cfg.Validate())
	g := cfg.Gmail()
	require.NotNil(t, g)
	assert.Equal(t, "client", g.ClientID)
	assert.Equal(t, "https://crm.example.com/auth/gmail/callback", g.RedirectURL)
	assert.True(t, g.Offline)
	assert.Contains(t, g.ExtraScopes, "https://www.googleapis.com/auth/gmail.readonly")
}

func TestGmailNeedsItsOwnClientOnceSignInIsntGoogle(t *testing.T) {
	setRequired(t)
	setOIDC(t)
	t.Setenv("OIDC_ISSUER", "https://identity.example.com")
	t.Setenv("TOKEN_ENCRYPTION_KEY", testTokenKey)
	assert.ErrorContains(t, Load().Validate(), "GMAIL_CLIENT_ID")

	t.Setenv("GMAIL_CLIENT_ID", "gmail-client")
	t.Setenv("GMAIL_CLIENT_SECRET", "gmail-secret")
	require.NoError(t, Load().Validate())
	assert.Equal(t, "https://accounts.google.com", Load().Gmail().Issuer)
}

func TestGmailNeedsRealSignInAndAGoodKey(t *testing.T) {
	setRequired(t)
	t.Setenv("DEV_USER_EMAIL", "dev@kthais.com")
	t.Setenv("TOKEN_ENCRYPTION_KEY", testTokenKey)
	assert.ErrorContains(t, Load().Validate(), "needs real sign-in")

	setOIDC(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", "too-short")
	assert.ErrorContains(t, Load().Validate(), "TOKEN_ENCRYPTION_KEY")
}
