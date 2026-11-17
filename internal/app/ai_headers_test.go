package app

import "testing"

func TestParseHeaders(t *testing.T) {
	got, err := parseHeaders("x-opencode-session: wearden\r\n\nX-Other:  a:b ")
	if err != nil || got["x-opencode-session"] != "wearden" || got["X-Other"] != "a:b" || len(got) != 2 {
		t.Fatalf("valid input rejected or misparsed: %v %v", got, err)
	}
	for _, bad := range []string{"Authorization: x", "x-api-key: x", "no colon", "Bad Name: x", "X-A:", "X: a\nCookie: b"} {
		if _, err := parseHeaders(bad); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
}
