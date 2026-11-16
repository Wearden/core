import { request } from "./api";

export interface SettingRow {
  key: string;
  label: string;
  secret: boolean;
  configured: boolean;
  source: "database" | "environment" | "none";
  value?: string;
}

export interface AiDecision {
  control_id: string;
  title: string;
  severity: string;
  action: "remediate" | "review" | "accept";
  priority: number;
  reason: string;
  auto_remediation: boolean;
  risky: boolean;
}

export interface AiAnalysis {
  scan_id: string;
  benchmark_id: string;
  model: string;
  summary: string;
  decisions: AiDecision[];
  created_by: string;
  created_at: string;
}

export const settingsApi = {
  list: () => request<{ vault_ready: boolean; settings: SettingRow[] }>("/settings"),
  set: (key: string, value: string) => request<unknown>(`/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),
  clear: (key: string) => request<unknown>(`/settings/${key}`, { method: "DELETE" }),
};

export const aiApi = {
  status: () => request<{ enabled: boolean }>("/ai/status"),
  stored: (scanId: string) => request<AiAnalysis>(`/ai/analyses/${scanId}`),
  analyze: (scanId: string, language: string) => request<AiAnalysis>("/ai/analyze", { method: "POST", body: JSON.stringify({ scan_id: scanId, language }) }),
};

export interface UserRow {
  id: number;
  username: string;
  role: "viewer" | "operator" | "admin";
  active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export const usersApi = {
  list: () => request<UserRow[]>("/users"),
  create: (body: { username: string; password: string; role: UserRow["role"] }) => request<unknown>("/users", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: { role?: UserRow["role"]; active?: boolean }) => request<void>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetPassword: (id: number, password: string) => request<void>(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),
  changeOwnPassword: (current: string, next: string) => request<void>("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) }),
};

export const aiAdminApi = {
  test: () => request<{ ok: boolean; message: string }>("/ai/test", { method: "POST" }),
  models: () => request<{ id: string; name: string }[]>("/ai/models"),
};
