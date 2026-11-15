export type OsType = "linux" | "windows";

export interface Asset {
  id: number;
  name: string;
  host: string;
  os_type: OsType;
  os_version: string | null;
  os_detected: string | null;
  privilege: string | null;
  ssh_port: number | null;
  rdp_port: number | null;
  winrm_port: number | null;
  winrm_https_port: number | null;
  tags: string[];
  status: "online" | "degraded" | "offline" | "unknown" | string;
  latency_ms: number | null;
  last_seen: string | null;
  last_checked: string | null;
  credential_username: string | null;
}

export interface AssetInput {
  name: string;
  host: string;
  os_type: OsType;
  os_version: string | null;
  ssh_port: number | null;
  rdp_port: number | null;
  winrm_port: number | null;
  winrm_https_port: number | null;
  tags: string[];
}

export interface CredentialInput {
  username: string;
  auth_type: "password" | "ssh_key";
  secret: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
  os_detected: string | null;
  privilege: string | null;
  latency_ms: number | null;
}

export interface HistorySample {
  checked_at: string;
  status: string;
  latency_ms: number | null;
}

export interface AuditRow {
  id: number;
  created_at: string;
  username: string | null;
  action: string;
  target: string | null;
  success: boolean;
  ip: string | null;
  detail: string | null;
}

export interface HostStatusUpdate {
  id: number;
  status: string;
  latency_ms: number | null;
  last_seen: string | null;
  last_checked: string | null;
}
