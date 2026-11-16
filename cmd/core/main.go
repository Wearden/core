package main

import (
	"context"
	"errors"
	"github.com/Wearden/core/internal/app"
	"github.com/Wearden/core/internal/benchmarks"
	"github.com/Wearden/core/internal/store"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		host := os.Getenv("DATABASE_HOST")
		if host == "" {
			return errors.New("DATABASE_URL or explicit DATABASE_HOST configuration is required")
		}
		port := os.Getenv("DATABASE_PORT")
		if port == "" {
			port = "5432"
		}
		mode := os.Getenv("DATABASE_SSLMODE")
		if mode == "" {
			mode = "verify-full"
		}
		u := url.URL{Scheme: "postgresql", Host: net.JoinHostPort(host, port), Path: "/" + os.Getenv("DATABASE_NAME"), User: url.UserPassword(os.Getenv("DATABASE_USER"), os.Getenv("DATABASE_PASSWORD"))}
		q := u.Query()
		q.Set("sslmode", mode)
		u.RawQuery = q.Encode()
		dsn = u.String()
	}
	root := os.Getenv("RULESET_PATH")
	if root == "" {
		root = "../ruleset"
	}
	catalog, err := benchmarks.Load(root)
	if err != nil {
		return errors.New("cannot load ruleset catalog: " + err.Error())
	}
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	db, err := store.Open(startup, dsn)
	if err != nil {
		return err
	}
	defer db.DB.Close()
	cfg := app.Config{SessionControlKey: os.Getenv("GUAC_CONTROL_KEY"), VaultKey: os.Getenv("WEARDEN_VAULT_KEY"), GuacKey: os.Getenv("GUAC_CRYPT_KEY"), RecordingsDir: os.Getenv("RECORDINGS_DIR"), AnthropicKey: os.Getenv("ANTHROPIC_API_KEY"), AnthropicModel: os.Getenv("ANTHROPIC_MODEL"), AllowedOrigin: os.Getenv("PUBLIC_ORIGIN"), DownloadsDir: os.Getenv("AGENT_DOWNLOADS_DIR")}
	if cfg.RecordingsDir == "" {
		cfg.RecordingsDir = "/data/recordings"
	}
	server := app.New(db, catalog, cfg)
	username := os.Getenv("ADMIN_USERNAME")
	if username == "" {
		username = "admin"
	}
	if err := server.Bootstrap(startup, username, os.Getenv("ADMIN_PASSWORD")); err != nil {
		return errors.New("administrator bootstrap failed: " + err.Error())
	}
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8000"
	}
	go server.RunWorker(ctx)
	httpServer := &http.Server{Addr: address, Handler: server.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
	errs := make(chan error, 1)
	go func() { slog.Info("Wearden core starting", "address", address); errs <- httpServer.ListenAndServe() }()
	select {
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdown)
	case err := <-errs:
		if err == http.ErrServerClosed {
			return nil
		}
		return errors.New("HTTP server stopped unexpectedly")
	}
}
