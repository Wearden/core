import { request } from "./api";

export interface Agent {
  id: string;
  asset_id?: number;
  hostname: string;
  os: "linux" | "windows";
  benchmark_id: string;
  version?: string;
  status: string;
  last_seen: string | null;
}

export interface AgentLog {
  id: number;
  logged_at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface EnrollmentToken {
  token: string;
  expires_at: string;
}

export interface RemoteInstallResult {
  status: "installed" | "failed" | "confirm_host_key";
  detail?: string;
  output?: string;
  host_key?: string;
  host_key_type?: string;
  host_key_changed?: boolean;
}

export const agentsApi = {
  list: () => request<Agent[]>("/agents"),
  enroll: (body: { os: Agent["os"]; benchmark_id: string; ttl_minutes: number }) =>
    request<EnrollmentToken>("/agents/enrollment-tokens", { method: "POST", body: JSON.stringify(body) }),
  logs: (id: string, level: string) => request<AgentLog[]>(`/agents/${encodeURIComponent(id)}/logs?limit=100${level ? `&level=${level}` : ""}`),
  installInfo: () => request<{ linux_available: boolean; windows_available: boolean; remote_install_ready: boolean }>("/agents/install-info"),
  installRemote: (assetId: number, body: { benchmark_id: string; allow_remediation: boolean; host_key: string; replace_host_key: boolean }) =>
    request<RemoteInstallResult>(`/assets/${assetId}/install-agent`, { method: "POST", body: JSON.stringify(body) }),
  revoke: (id: string) => request<void>(`/agents/${encodeURIComponent(id)}/revoke`, { method: "POST" }),
};
