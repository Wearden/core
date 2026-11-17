package app

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestValidAvatar(t *testing.T) {
	png := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte{0x89, 'P', 'N', 'G', 1, 2, 3})
	jpeg := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte{0xFF, 0xD8, 0xFF, 0xE0})
	for _, ok := range []string{"", png, jpeg} {
		if !validAvatar(ok) {
			t.Errorf("should accept %.40q", ok)
		}
	}
	big := "data:image/png;base64," + base64.StdEncoding.EncodeToString(append([]byte{0x89, 'P', 'N', 'G'}, make([]byte, maxAvatarBytes)...))
	for _, bad := range []string{
		"data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte("<svg onload=alert(1)>")),
		"data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("not a png")),
		"data:image/png;base64,%%%",
		"https://example.com/a.png",
		big,
	} {
		if validAvatar(bad) {
			t.Errorf("should refuse %.40q", bad)
		}
	}
}

func TestCleanText(t *testing.T) {
	if v, ok := cleanText("  Ali  ", 60); !ok || v != "Ali" {
		t.Fatalf("got %q %v", v, ok)
	}
	if _, ok := cleanText("a\nb", 60); ok {
		t.Error("control characters must be refused")
	}
	if _, ok := cleanText(strings.Repeat("ə", 61), 60); ok {
		t.Error("61 runes must be refused")
	}
}
