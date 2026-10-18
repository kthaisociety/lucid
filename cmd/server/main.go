package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/kthaisociety/lucid/frontend"
	"github.com/kthaisociety/lucid/internal/auth"
	"github.com/kthaisociety/lucid/internal/config"
	"github.com/kthaisociety/lucid/internal/database"
	"github.com/kthaisociety/lucid/internal/deals"
	"github.com/kthaisociety/lucid/internal/fathom"
	"github.com/kthaisociety/lucid/internal/gmail"
	"github.com/kthaisociety/lucid/internal/secretbox"
	"github.com/kthaisociety/lucid/internal/handlers"
)

// How often connected mailboxes are synced.
const gmailSyncEvery = 5 * time.Minute

func main() {
	// Best effort: in a container the variables are set directly and there's no .env.
	_ = godotenv.Load()

	cfg := config.Load()
	err := cfg.Validate()
	if err != nil {
		log.Fatal(err)
	}
	if len(os.Args) > 1 && os.Args[1] == "appoint-admin" {
		appointAdmin(cfg, os.Args[2:])
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	var oidc *auth.OIDC
	switch o := cfg.OIDC(); {
	case o != nil:
		discoverCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		oidc, err = auth.NewOIDC(discoverCtx, *o)
		cancel()
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("signing in with %s for %s accounts; callback %s (docs/adr/0004)", o.Issuer, o.Domain, o.RedirectURL)
	case cfg.DevUser() != nil:
		log.Printf("WARNING: every request is signed in as dev user %s, for local work only (docs/pcr/0007)", cfg.DevUserEmail)
	default:
		log.Printf("no OIDC client and no DEV_USER_EMAIL: the API refuses every request but health")
	}

	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	if err := database.Migrate(ctx, db); err != nil {
		log.Fatal(err)
	}

	deps := handlers.Deps{
		PingDB:   func(ctx context.Context) error { return database.Ping(ctx, db) },
		Frontend: frontend.Dist(),
		DevUser:  cfg.DevUser(),
		Deals:    deals.NewStore(db),
	}
	if f := cfg.Fathom(); f != nil {
		box, _ := secretbox.New(cfg.TokenEncryptionKey) // checked by Validate
		deps.FathomOAuth = auth.NewOAuth(*f)
		deps.Fathom = fathom.NewConnections(db, box, deps.FathomOAuth, cfg.PublicURL)
		log.Printf("Connect Fathom is on; callback %s, webhooks at %s (docs/adr/0008)", f.RedirectURL, cfg.PublicURL+fathom.WebhookPath("…"))
	}
	if g := cfg.Gmail(); g != nil {
		discoverCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		deps.GmailOIDC, err = auth.NewOIDC(discoverCtx, *g)
		cancel()
		if err != nil {
			log.Fatal(err)
		}
		box, _ := secretbox.New(cfg.TokenEncryptionKey) // checked by Validate
		deps.Gmail = gmail.NewConnections(db, box)
		google := deps.GmailOIDC
		deps.GmailSync = gmail.NewSyncer(deps.Gmail, google.Client, deps.Deals)
		go deps.GmailSync.Run(ctx, gmailSyncEvery)
		log.Printf("Connect Gmail is on, syncing every %s; callback %s (docs/adr/0006)", gmailSyncEvery, g.RedirectURL)
	}
	if oidc != nil {
		deps.OIDC, deps.Sessions = oidc, auth.NewSessions(db, cfg.PublicURL)
		deps.Deals.OnlyTeamMembers()
	}
	router := handlers.NewRouter(deps)

	srv := &http.Server{
		Addr:              net.JoinHostPort(cfg.Host, cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Printf("lucid listening on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

// appointAdmin is `lucid appoint-admin [-name NAME] [-force] EMAIL`: it makes someone the first
// admin of a new environment, run once from the same image (docs/adr/0005). After that, admins hand over
// on the Team page; -force adds an admin anyway, to recover a team whose admins have all left.
func appointAdmin(cfg *config.Config, args []string) {
	flags := flag.NewFlagSet("appoint-admin", flag.ExitOnError)
	name := flags.String("name", "", "their name until they sign in (default: the email's local part)")
	force := flags.Bool("force", false, "appoint even though the team has an admin (recovery only)")
	flags.Usage = func() {
		fmt.Fprintln(flags.Output(), "usage: ./lucid appoint-admin [-name NAME] [-force] EMAIL")
		flags.PrintDefaults()
	}
	_ = flags.Parse(args)
	if flags.NArg() != 1 {
		flags.Usage()
		os.Exit(2)
	}

	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	if err := database.Migrate(ctx, db); err != nil {
		log.Fatal(err)
	}
	admin, err := deals.NewStore(db).AppointAdmin(ctx, flags.Arg(0), *name, *force)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("%s <%s> is an admin", admin.Name, admin.Email)
}
