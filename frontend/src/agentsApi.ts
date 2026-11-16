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

export const agentsApi = {
  list: () => request<Agent[]>("/agents"),
  enroll: (body: { os: Agent["os"]; benchmark_id: string; ttl_minutes: number }) =>
    request<EnrollmentToken>("/agents/enrollment-tokens", { method: "POST", body: JSON.stringify(body) }),
  logs: (id: string, level: string) => request<AgentLog[]>(`/agents/${encodeURIComponent(id)}/logs?limit=100${level ? `&level=${level}` : ""}`),
  installInfo: () => request<{ linux_available: boolean }>("/agents/install-info"),
  revoke: (id: string) => request<void>(`/agents/${encodeURIComponent(id)}/revoke`, { method: "POST" }),
};
