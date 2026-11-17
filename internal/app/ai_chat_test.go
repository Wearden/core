package app

import "testing"

func TestCleanChatReply(t *testing.T) {
	if got := cleanChatReply("You: Open Settings — then AI – done"); got != "Open Settings - then AI - done" {
		t.Fatalf("got %q", got)
	}
}
