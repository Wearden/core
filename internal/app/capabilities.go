package app

func actionSupported(osName, id string) bool {
	if osName == "linux" {
		switch id {
		case "LNX-NET-002", "LNX-NET-003", "LNX-NET-004", "LNX-NET-005", "LNX-NET-006", "LNX-NET-007", "LNX-NET-008":
			return true
		case "LNX-FS-001", "LNX-FS-002", "LNX-FS-003", "LNX-FS-004", "LNX-FS-005", "LNX-FS-007", "LNX-FS-008", "LNX-NET-009", "LNX-NET-010", "LNX-NET-011", "LNX-NET-012", "LNX-LOG-001", "LNX-LOG-002", "LNX-LOG-003", "LNX-SSH-001", "LNX-USR-001", "LNX-USR-003", "LNX-USR-010", "LNX-USR-011", "LNX-USR-012":
			return true
		}
	}
	if osName == "windows" {
		switch id {
		case "WIN-FW-001", "WIN-FW-002", "WIN-FW-003", "WIN-FW-004", "WIN-FW-005", "WIN-FW-006":
			return true
		case "WIN-URA-001", "WIN-URA-002", "WIN-URA-003", "WIN-URA-004", "WIN-URA-005", "WIN-URA-006", "WIN-URA-007", "WIN-URA-008", "WIN-URA-009", "WIN-URA-010", "WIN-URA-011", "WIN-URA-012":
			return true
		case "WIN-SVC-001", "WIN-SVC-002", "WIN-SVC-003", "WIN-SVC-004", "WIN-SVC-005", "WIN-SVC-006":
			return true
		case "WIN-SEC-004", "WIN-SEC-005", "WIN-SMB-010":
			return true
		case "WIN-AUD-001", "WIN-AUD-002", "WIN-AUD-003", "WIN-AUD-004", "WIN-AUD-005", "WIN-AUD-006", "WIN-AUD-007", "WIN-AUD-008", "WIN-AUD-009", "WIN-AUD-010", "WIN-AUD-011", "WIN-AUD-012", "WIN-AUD-013", "WIN-AUD-014", "WIN-AUD-015", "WIN-AUD-016", "WIN-AUD-017", "WIN-AUD-018":
			return true
		case "WIN-PWD-001", "WIN-PWD-003", "WIN-PWD-004", "WIN-PWD-005", "WIN-PWD-006", "WIN-PWD-007", "WIN-PWD-008":
			return true
		case "WIN-SEC-003", "WIN-RDP-003", "WIN-RDP-004":
			return true
		case "WIN-SEC-011", "WIN-SEC-012", "WIN-SEC-013", "WIN-SEC-014", "WIN-SEC-015", "WIN-SEC-016", "WIN-SEC-017", "WIN-SEC-018", "WIN-SEC-020", "WIN-SMB-001", "WIN-SMB-002", "WIN-SMB-007", "WIN-SMB-008", "WIN-SMB-009", "WIN-RDP-001", "WIN-RDP-002", "WIN-RDP-005", "WIN-RDP-006":
			return true
		case "WIN-SEC-001", "WIN-SEC-002", "WIN-SEC-006", "WIN-SEC-007", "WIN-SEC-008", "WIN-SEC-009", "WIN-SEC-010", "WIN-SEC-019", "WIN-DEF-006", "WIN-DEF-008":
			return true
		}
	}
	return false
}

func actionRisky(osName, id string, declared bool) bool {
	if declared {
		return true
	}
	if osName == "linux" {
		switch id {
		case "LNX-NET-002", "LNX-NET-003", "LNX-NET-004", "LNX-NET-005", "LNX-NET-006", "LNX-NET-007", "LNX-NET-008":
			return true
		}
	}
	if osName == "windows" {
		switch id {
		case "WIN-FW-001", "WIN-FW-002", "WIN-FW-003", "WIN-FW-004", "WIN-FW-005", "WIN-FW-006":
			return true
		case "WIN-URA-001", "WIN-URA-002", "WIN-URA-003", "WIN-URA-004", "WIN-URA-005", "WIN-URA-006", "WIN-URA-007", "WIN-URA-008", "WIN-URA-009", "WIN-URA-010", "WIN-URA-011", "WIN-URA-012":
			return true
		case "WIN-SVC-001", "WIN-SVC-002", "WIN-SVC-003", "WIN-SVC-004", "WIN-SVC-005", "WIN-SVC-006":
			return true
		case "WIN-SEC-004", "WIN-SEC-005", "WIN-SMB-010":
			return true
		case "WIN-AUD-001", "WIN-AUD-002", "WIN-AUD-003", "WIN-AUD-004", "WIN-AUD-005", "WIN-AUD-006", "WIN-AUD-007", "WIN-AUD-008", "WIN-AUD-009", "WIN-AUD-010", "WIN-AUD-011", "WIN-AUD-012", "WIN-AUD-013", "WIN-AUD-014", "WIN-AUD-015", "WIN-AUD-016", "WIN-AUD-017", "WIN-AUD-018":
			return true
		case "WIN-PWD-001", "WIN-PWD-003", "WIN-PWD-004", "WIN-PWD-005", "WIN-PWD-006", "WIN-PWD-007", "WIN-PWD-008":
			return true
		case "WIN-SEC-003", "WIN-RDP-003", "WIN-RDP-004":
			return true
		case "WIN-SEC-011", "WIN-SEC-012", "WIN-SEC-013", "WIN-SEC-014", "WIN-SEC-015", "WIN-SEC-016", "WIN-SEC-017", "WIN-SEC-018", "WIN-SEC-020", "WIN-SMB-001", "WIN-SMB-002", "WIN-SMB-007", "WIN-SMB-008", "WIN-SMB-009", "WIN-RDP-001", "WIN-RDP-002", "WIN-RDP-005", "WIN-RDP-006":
			return true
		}
	}
	return false
}
