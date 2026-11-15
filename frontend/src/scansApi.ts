import { request } from "./api";

export type CheckStatus = "pass" | "fail" | "error" | "not_applicable";
export type ScanStatus = "queued" | "running" | "cancel_requested" | "completed" | "cancelled" | "failed";

export interface ScanSummary {
  id: string;
  name: string;
  benchmark_id: string;
  profile_name: string;
  status: ScanStatus | string;
  total_checks: number;
  done_checks: number;
  host_count: number;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface HostResult {
  id: number;
  asset_id: number | null;
  asset_name: string;
  host: string;
  os_detected: string | null;
  status: string;
  passed: number;
  failed: number;
  errored: number;
  not_applicable: number;
  score: number | null;
  weighted_score: number | null;
  message: string | null;
}

export interface ScanDetail extends ScanSummary {
  message: string | null;
  hosts: HostResult[];
}

export interface ControlResultRow {
  id: number;
  host_result_id: number;
  asset_name: string;
  control_id: string;
  title: string;
  category: string;
  severity: string;
  status: CheckStatus | string;
  actual: string | null;
  expected: string;
  raw_output: string | null;
  duration_ms: number;
  message: string | null;
  checked_at: string;
}

export const scansApi = {
  list: () => request<ScanSummary[]>("/scans"),
  get: (id: string) => request<ScanDetail>(`/scans/${id}`),
  results: (id: string, hostId?: number, status?: string) => {
    const params = new URLSearchParams();
    if (hostId !== undefined) params.set("host_id", String(hostId));
    if (status) params.set("status_filter", status);
    const qs = params.toString();
    return request<ControlResultRow[]>(`/scans/${id}/results${qs ? `?${qs}` : ""}`);
  },
  create: (body: { name?: string; benchmark_id: string; profile_id: string; asset_ids: number[] }) =>
    request<ScanDetail>("/scans", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) => request<ScanDetail>(`/scans/${id}/cancel`, { method: "POST" }),
};
