package store

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	"net/url"
	"os"
	"time"
)

//go:embed migrations/001_initial.sql
var migration string

type Store struct{ DB *sql.DB }

func Open(ctx context.Context, dsn string) (*Store, error) {
	u, err := url.Parse(dsn)
	if err != nil || u.Hostname() == "" || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.User == nil {
		return nil, errors.New("DATABASE_URL must be a PostgreSQL URL with explicit credentials")
	}
	password, ok := u.User.Password()
	if !ok || password == "" || u.User.Username() == "" {
		return nil, errors.New("explicit database username and password are required; credential-file fallback is disabled")
	}
	q := u.Query()
	for _, k := range []string{"service", "servicefile", "passfile", "sslpassword"} {
		if q.Has(k) {
			return nil, fmt.Errorf("database option %s is not permitted", k)
		}
	}
	// Avoid pgx home-directory credential and certificate discovery. Custom certificate support must be explicitly added.
	for _, k := range []string{"PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGSSLCERT", "PGSSLKEY", "PGSSLROOTCERT", "PGSSLPASSWORD"} {
		if err := os.Unsetenv(k); err != nil {
			return nil, errors.New("cannot disable PostgreSQL file discovery")
		}
	}
	for _, k := range []string{"sslcert", "sslkey", "sslrootcert"} {
		q.Set(k, "")
	}
	if q.Get("sslmode") == "" {
		q.Set("sslmode", "verify-full")
	}
	if q.Get("sslmode") != "verify-full" && q.Get("sslmode") != "disable" {
		return nil, errors.New("use sslmode=verify-full, or explicit sslmode=disable for the isolated compose database")
	}
	u.RawQuery = q.Encode()
	db, err := sql.Open("pgx", u.String())
	if err != nil {
		return nil, errors.New("cannot configure database")
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, errors.New("database connection failed")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		db.Close()
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(73194331)"); err == nil {
		var usersExist, owned bool
		err = tx.QueryRowContext(ctx, "SELECT to_regclass('public.users') IS NOT NULL,to_regclass('public.wearden_migrations') IS NOT NULL").Scan(&usersExist, &owned)
		if err == nil && usersExist && !owned {
			tx.Rollback()
			db.Close()
			return nil, errors.New("database already contains an unowned users table; use a fresh Wearden database")
		}
		if err == nil {
			_, err = tx.ExecContext(ctx, migration)
		}
	}
	if err != nil {
		db.Close()
		return nil, errors.New("database migration failed")
	}
	if err = tx.Commit(); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{DB: db}, nil
}
func (s *Store) Get(ctx context.Context, collection, id string) (map[string]any, error) {
	var data []byte
	err := s.DB.QueryRowContext(ctx, "SELECT data FROM documents WHERE collection=$1 AND id=$2", collection, id).Scan(&data)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	err = json.Unmarshal(data, &m)
	return m, err
}
func (s *Store) List(ctx context.Context, collection string) ([]map[string]any, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT data FROM documents WHERE collection=$1 ORDER BY created_at DESC,id DESC LIMIT 500", collection)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func (s *Store) Put(ctx context.Context, collection, id string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, "INSERT INTO documents(collection,id,data) VALUES($1,$2,$3) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data", collection, id, data)
	return err
}
