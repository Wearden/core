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
  status: () => request<{ enabled: boolean; chat_enabled?: boolean }>("/ai/status"),
  stored: (scanId: string) => request<AiAnalysis>(`/ai/analyses/${scanId}`),
  chat: (messages: { role: string; content: string }[], language: string, page: string) => request<{ reply: string }>("/ai/chat", { method: "POST", body: JSON.stringify({ messages, language, page }) }),
  analyze: (scanId: string, language: string) => request<AiAnalysis>("/ai/analyze", { method: "POST", body: JSON.stringify({ scan_id: scanId, language }) }),
};

export interface UserRow {
  id: number;
  username: string;
  role: string;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
  /** Registered on their own and waiting for the administrator to approve. */
  pending: boolean;
}

export const usersApi = {
  list: () => request<UserRow[]>("/users"),
  create: (body: { username: string; password: string; role: string }) => request<unknown>("/users", { method: "POST", body: JSON.stringify(body) }),
  remove: (id: number) => request<void>(`/users/${id}`, { method: "DELETE" }),
  approve: (id: number) => request<void>(`/users/${id}/approve`, { method: "POST" }),
  update: (id: number, body: { role?: string; active?: boolean }) => request<void>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetPassword: (id: number, password: string) => request<void>(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),
  changeOwnPassword: (current: string, next: string) => request<void>("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) }),
};

export type ProviderKind = "anthropic" | "openai";

export interface AiProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  base_url: string;
  model: string;
  has_key: boolean;
  enabled: boolean;
  default: boolean;
  chat?: boolean;
  headers?: string;
  /** Provided by the older key and model settings; edit it under Agents and logs. */
  readonly: boolean;
}

export interface AiProviderInput {
  name: string;
  kind: ProviderKind;
  base_url: string;
  model: string;
  api_key?: string;
  clear_key?: boolean;
  headers?: string;
  enabled?: boolean;
}

export const aiAdminApi = {
  providers: () => request<{ vault_ready: boolean; providers: AiProvider[] }>("/ai/providers"),
  create: (body: AiProviderInput) => request<AiProvider>("/ai/providers", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: AiProviderInput) => request<AiProvider>(`/ai/providers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: string) => request<void>(`/ai/providers/${id}`, { method: "DELETE" }),
  check: (body: AiProviderInput & { id?: string }) => request<{ ok: boolean; message: string; latency_ms?: number; models?: { id: string; name: string }[]; model_listed?: boolean }>("/ai/providers/check", { method: "POST", body: JSON.stringify(body) }),
  useForChat: (id: string) => request<void>(`/ai/providers/${id}/chat`, { method: "POST" }),
  chatFollowsDefault: () => request<void>("/ai/chat-provider", { method: "DELETE" }),
  makeDefault: (id: string) => request<void>(`/ai/providers/${id}/default`, { method: "POST" }),
  test: (id: string) => request<{ ok: boolean; message: string; model?: string; latency_ms?: number }>(`/ai/providers/${id}/test`, { method: "POST" }),
  models: (id: string) => request<{ id: string; name: string }[]>(`/ai/providers/${id}/models`),
};

export interface PermissionDef {
  id: string;
  group: string;
  label: string;
}

export interface RoleRow {
  name: string;
  description: string;
  level: "viewer" | "operator" | "admin";
  permissions: string[];
  builtin: boolean;
  users: number;
}

export interface RoleInput {
  name: string;
  description: string;
  level: "viewer" | "operator";
  permissions: string[];
}

export const rolesApi = {
  list: () => request<{ roles: RoleRow[]; permissions: PermissionDef[] }>("/roles"),
  create: (body: RoleInput) => request<unknown>("/roles", { method: "POST", body: JSON.stringify(body) }),
  update: (body: RoleInput) => request<unknown>(`/roles/${body.name}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (name: string) => request<void>(`/roles/${name}`, { method: "DELETE" }),
};

export const registrationApi = {
  get: () => request<{ open: boolean }>("/registration"),
  set: (open: boolean) => request<{ open: boolean }>("/registration", { method: "PUT", body: JSON.stringify({ open }) }),
};
