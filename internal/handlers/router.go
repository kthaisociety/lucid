// Package handlers is the HTTP layer: the JSON API under /api, and the frontend everywhere else
// (docs/adr/0001).
package handlers

import (
	"context"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/kthaisociety/lucid/internal/auth"
	"github.com/kthaisociety/lucid/internal/deals"
	"github.com/kthaisociety/lucid/internal/gmail"
)

type Deps struct {
	PingDB func(ctx context.Context) error
	// Frontend is the built frontend (frontend.Dist()).
	Frontend fs.FS
	// Real sign-in (docs/adr/0004): with OIDC and Sessions set, requests are signed in from their session
	// cookie. Otherwise DevUser signs every request in, for local work (docs/pcr/0007); with neither, every
	// request but health is refused.
	OIDC     *auth.OIDC
	Sessions *auth.Sessions
	DevUser  *auth.User
	Deals    *deals.Store
	// FathomKey turns on /api/integrations/fathom (docs/adr/0006); nil leaves it off.
	FathomKey []byte
	// GmailOIDC and Gmail turn on Connect Gmail (docs/adr/0006), with real sign-in; nil leaves it off.
	GmailOIDC *auth.OIDC
	Gmail     *gmail.Connections
	// GmailSync, if set, is asked to sync a mailbox right after it's connected.
	GmailSync *gmail.Syncer
}

func NewRouter(d Deps) *gin.Engine {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	api := r.Group("/api", limitBody(maxBodyBytes))
	api.GET("/health", health(d.PingDB))

	signIn := auth.Middleware(d.DevUser)
	if d.Sessions != nil {
		signIn = d.Sessions.Middleware()
		registerSignIn(r, d.OIDC, d.Sessions, d.Deals)
	}
	signedIn := api.Group("", signIn)
	signedIn.GET("/me", me(d.Deals, d.Sessions != nil, d.Gmail))
	if d.Deals != nil {
		signedIn.PATCH("/me", updateMe(d.Deals))
	}
	signedIn.GET("/deals", listDeals(d.Deals))
	signedIn.POST("/deals", createDeal(d.Deals))
	signedIn.GET("/deals/:id", getDeal(d.Deals))
	signedIn.PATCH("/deals/:id", updateDeal(d.Deals))
	signedIn.POST("/deals/:id/notes", addNote(d.Deals))
	registerCompanies(signedIn, d.Deals)
	registerTeam(signedIn, d.Deals, d.Gmail)
	if d.Gmail != nil && d.Sessions != nil {
		registerGmail(r, signedIn, d.GmailOIDC, d.Sessions, d.Gmail, d.GmailSync)
	}

	if d.FathomKey != nil {
		r.POST("/api/integrations/fathom", limitBody(maxWebhookBytes), fathomWebhook(d.FathomKey, d.Deals))
	}

	r.NoRoute(frontend(d.Frontend))
	return r
}

func health(pingDB func(ctx context.Context) error) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := pingDB(c.Request.Context()); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"service": "lucid", "status": "unhealthy", "database": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"service": "lucid", "status": "healthy"})
	}
}

// me is the signed-in user and, with a store, who they are on the team; canSignOut is false for the dev
// user, who is always signed in. gmail is "off", "connected", "not-connected" or "reconnect", when Google
// no longer honours the grant (docs/adr/0006).
func me(store *deals.Store, canSignOut bool, conns *gmail.Connections) gin.HandlerFunc {
	return func(c *gin.Context) {
		user := auth.Current(c)
		if store == nil {
			c.JSON(http.StatusOK, gin.H{"sub": user.Subject, "email": user.Email, "name": user.Name, "canSignOut": canSignOut})
			return
		}
		member, err := store.SignIn(c.Request.Context(), user)
		if err != nil {
			fail(c, err)
			return
		}
		mailbox := "off"
		if conns != nil {
			status, err := conns.Status(c.Request.Context(), member.ID)
			if err != nil {
				fail(c, err)
				return
			}
			switch {
			case !status.Connected:
				mailbox = "not-connected"
			case status.SyncError == gmail.NeedsReconnect:
				mailbox = "reconnect"
			default:
				mailbox = "connected"
			}
		}
		c.JSON(http.StatusOK, gin.H{"sub": user.Subject, "email": user.Email, "name": user.Name, "memberId": member.ID, "role": member.Role, "title": member.Title, "canSignOut": canSignOut, "gmail": mailbox})
	}
}

// updateMe changes the signed-in member's own profile: their title. It answers with them as a member.
func updateMe(store *deals.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, ok := readBody(c)
		if !ok {
			return
		}
		cols, err := deals.ParseProfilePatch(body)
		if err != nil {
			fail(c, err)
			return
		}
		member, err := store.UpdateProfile(c.Request.Context(), auth.Current(c), cols)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, member)
	}
}

// frontend serves the single-page app: a file if one exists at the path, otherwise index.html so
// client-side routes work on reload. Unknown /api paths stay JSON 404s.
func frontend(dist fs.FS) gin.HandlerFunc {
	files := http.FileServerFS(dist)
	return func(c *gin.Context) {
		p := c.Request.URL.Path
		if p == "/api" || strings.HasPrefix(p, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.Status(http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(path.Clean(p), "/")
		if name != "" && name != "index.html" {
			if info, err := fs.Stat(dist, name); err == nil && !info.IsDir() {
				if strings.HasPrefix(name, "assets/") {
					// Vite puts a content hash in every asset's name.
					c.Header("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(c.Writer, c.Request)
				return
			}
		}

		index, err := fs.ReadFile(dist, "index.html")
		if err != nil {
			c.String(http.StatusServiceUnavailable, "frontend not built: run `npm run build` in frontend/")
			return
		}
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "text/html; charset=utf-8", index)
	}
}
