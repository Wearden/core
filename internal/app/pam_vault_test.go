package app

import (
	"testing"
	"time"
)

func TestVaultOutNeverListsSecret(t *testing.T) {
	soon := stamp(nowUTC().Add(10 * time.Minute))
	doc := map[string]any{"id": "a", "name": "db root", "sealed": "c2VjcmV0", "checked_out_by": "ali", "checked_out_by_id": float64(7), "checkout_expires_at": soon}
	out := vaultOut(doc, User{ID: 7})
	if _, ok := out["sealed"]; ok {
		t.Fatal("sealed secret must not be listed")
	}
	if out["checked_out"] != true || out["mine"] != true {
		t.Fatalf("want an active check-out held by the caller, got %v", out)
	}
	if vaultOut(doc, User{ID: 8})["mine"] != false {
		t.Fatal("another user must not be the holder")
	}
	doc["checkout_expires_at"] = stamp(nowUTC().Add(-time.Second))
	if vaultOut(doc, User{ID: 7})["checked_out"] != false {
		t.Fatal("an expired check-out must count as checked in")
	}
}

func TestJITGrantLifetime(t *testing.T) {
	g := map[string]any{"status": "approved", "expires_at": stamp(nowUTC().Add(time.Minute))}
	if !jitActive(g) || jitOut(g)["status"] != "approved" {
		t.Fatal("grant inside its window must be active")
	}
	g["expires_at"] = stamp(nowUTC().Add(-time.Minute))
	if jitActive(g) || jitOut(g)["status"] != "expired" {
		t.Fatal("grant past its window must show as expired")
	}
	if jitActive(map[string]any{"status": "revoked", "expires_at": stamp(nowUTC().Add(time.Hour))}) {
		t.Fatal("revoked grant must not be active")
	}
	if clampMinutes(1) != jitMinMinutes || clampMinutes(100000) != jitMaxMinutes || clampMinutes(60) != 60 {
		t.Fatal("durations must be clamped to 5 minutes .. 8 hours")
	}
	hour := nowUTC().Add(time.Hour)
	if got := earlier(hour, stamp(nowUTC().Add(time.Minute))); !got.Before(hour) {
		t.Fatal("a session or check-out must end with its grant")
	}
	if got := earlier(hour, nil); !got.Equal(hour) {
		t.Fatal("no grant must leave the end unchanged")
	}
}
