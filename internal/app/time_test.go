package app

import "testing"

func TestLocalTime(t *testing.T) {
	cases := []struct {
		key  string
		in   any
		want any
	}{
		{"started_at", "2026-11-17T07:56:59.123Z", "2026-11-17T11:56:59+04:00"},
		{"checked_at", "2026-11-17T22:30:00Z", "2026-11-18T02:30:00+04:00"},
		{"started_at", "", ""},
		{"started_at", "not a time", "not a time"},
		{"started_at", nil, nil},
		{"status", "2026-11-17T07:56:59Z", "2026-11-17T07:56:59Z"},
	}
	for _, c := range cases {
		if got := localTime(c.key, c.in); got != c.want {
			t.Errorf("localTime(%q, %v) = %v, want %v", c.key, c.in, got, c.want)
		}
	}
}
