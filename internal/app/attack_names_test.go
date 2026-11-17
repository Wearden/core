package app

import "testing"

func TestAttackNames(t *testing.T) {
	for id, want := range map[string]string{
		"T1041":     "Exfiltration Over C2 Channel",
		"T1110.001": "Brute Force: Password Guessing",
		"T1562.002": "Impair Defenses: Disable Windows Event Logging", // revoked by MITRE, still used by rules
	} {
		if got := attackNames[id]; got != want {
			t.Errorf("attackNames[%q] = %q, want %q", id, got, want)
		}
	}
}
