import { request } from "./api";

export type VaultType = "password" | "ssh_key" | "certificate" | "api_key";

/** A vault entry as listed: the secret itself is never part of it. */
export interface VaultEntry {
  id: string;
  name: string;
  type: VaultType;
  username: string;
  asset_id: number | null;
  asset_name: string | null;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  checked_out: boolean;
  checked_out_by?: string;
  checkout_expires_at?: string;
  checkout_reason?: string;
  mine?: boolean;
}

export interface VaultInput {
  name: string;
  type: VaultType;
  username: string;
  asset_id: number;
  secret: string;
  notes: string;
}

export type GrantStatus = "pending" | "approved" | "denied" | "revoked" | "expired";

export interface JitGrant {
  id: string;
  user_id: number;
  username: string;
  target_type: "asset" | "vault";
  target_id: number | string;
  target_name: string;
  minutes: number;
  reason: string;
  status: GrantStatus;
  requested_at: string;
  decided_by?: string;
  decided_at?: string;
  self_approved?: boolean;
  starts_at?: string;
  expires_at?: string;
  revoked_by?: string;
}

export interface JitState {
  policy: { required: boolean; min_minutes: number; max_minutes: number };
  grants: JitGrant[];
  can_approve: boolean;
}

export const vaultApi = {
  list: () => request<VaultEntry[]>("/pam/vault"),
  create: (body: VaultInput) => request<VaultEntry>("/pam/vault", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: VaultInput) => request<VaultEntry>(`/pam/vault/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: string) => request<void>(`/pam/vault/${id}`, { method: "DELETE" }),
  checkout: (id: string, minutes: number, reason: string) =>
    request<VaultEntry>(`/pam/vault/${id}/checkout`, { method: "POST", body: JSON.stringify({ minutes, reason }) }),
  checkin: (id: string) => request<VaultEntry>(`/pam/vault/${id}/checkin`, { method: "POST" }),
  secret: (id: string) => request<{ secret: string; expires_at: string }>(`/pam/vault/${id}/secret`),
};

export const jitApi = {
  state: () => request<JitState>("/pam/jit"),
  request: (body: { target_type: "asset" | "vault"; target_id: string; minutes: number; reason: string }) =>
    request<JitGrant>("/pam/jit", { method: "POST", body: JSON.stringify(body) }),
  approve: (id: string) => request<JitGrant>(`/pam/jit/${id}/approve`, { method: "POST" }),
  deny: (id: string) => request<JitGrant>(`/pam/jit/${id}/deny`, { method: "POST" }),
  revoke: (id: string) => request<JitGrant>(`/pam/jit/${id}/revoke`, { method: "POST" }),
  setPolicy: (required: boolean) => request<JitState["policy"]>("/pam/jit/policy", { method: "PUT", body: JSON.stringify({ required }) }),
};

/** Durations offered when requesting access or checking out a secret, in minutes. */
export const DURATIONS = [15, 30, 60, 120, 240, 480];

/** "in 23 min", "in 1 h 05 min" or "ended" for a future RFC3339 time. */
export function timeLeft(iso?: string): string {
  if (!iso) return "";
  const m = Math.ceil((new Date(iso).getTime() - Date.now()) / 60000);
  if (m <= 0) return "ended";
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
