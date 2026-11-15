import { request } from "./api";

export interface Agent {
  id: string;
  asset_id?: number;
  hostname: string;
  os: "linux" | "windows";
  benchmark_id: string;
  status: string;
  last_seen: string | null;
}

export interface EnrollmentToken {
  token: string;
  expires_at: string;
}

export const agentsApi = {
  list: () => request<Agent[]>("/agents"),
  enroll: (body: { os: Agent["os"]; benchmark_id: string; ttl_minutes: number }) =>
    request<EnrollmentToken>("/agents/enrollment-tokens", { method: "POST", body: JSON.stringify(body) }),
  revoke: (id: string) => request<void>(`/agents/${encodeURIComponent(id)}/revoke`, { method: "POST" }),
};
