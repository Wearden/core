import { request, fetchBlobUrl } from "./api";

export interface DashboardData {
  hosts_total: number;
  hosts_online: number;
  hosts_degraded: number;
  hosts_offline: number;
  hosts_unknown: number;
  hosts_scanned: number;
  average_score: number | null;
  critical_failed: number;
  scans_total: number;
  scans_active: number;
  changes_applied: number;
  recent_activity: { at: string; user: string | null; action: string; target: string | null; success: boolean }[];
  scores_by_host: { asset_id: number; asset_name: string; score: number | null }[];
}

export interface ScorePoint {
  scan_id: string;
  scan_name: string;
  at: string;
  score: number | null;
  weighted_score: number | null;
}

export interface HostAnalytics {
  asset: { id: number; name: string; host: string; os_detected: string | null; status: string };
  latest: {
    scan_id: string;
    scan_name: string;
    status: string;
    score: number | null;
    weighted_score: number | null;
    passed: number;
    failed: number;
    errored: number;
    not_applicable: number;
  } | null;
  donut: { name: string; value: number }[];
  categories: { category: string; pass: number; fail: number; error: number }[];
  severities: { severity: string; pass: number; fail: number }[];
  trend: ScorePoint[];
  before_after: { before: ScorePoint | null; after: ScorePoint | null };
  hardening: { run_id?: string; run_name?: string; counts?: Record<string, number> };
}

export interface Heatmap {
  categories: string[];
  rows: { asset_id: number; asset_name: string; cells: Record<string, number | null> }[];
}

export interface DiffRow {
  change_id: number;
  asset_name: string;
  control_id: string;
  title: string;
  category: string;
  severity: string;
  expected: string;
  before: string | null;
  after: string | null;
  status: string;
  rollback_status: string | null;
}

export const analyticsApi = {
  dashboard: () => request<DashboardData>("/analytics/dashboard"),
  host: (id: number) => request<HostAnalytics>(`/analytics/hosts/${id}`),
  heatmap: (benchmarkId: string) => request<Heatmap>(`/analytics/heatmap?benchmark_id=${encodeURIComponent(benchmarkId)}`),
  diff: (params: { runId?: string; assetId?: number; status?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params.runId) qs.set("run_id", params.runId);
    if (params.assetId !== undefined) qs.set("asset_id", String(params.assetId));
    if (params.status) qs.set("status", params.status);
    if (params.q) qs.set("q", params.q);
    return request<{ run_id: string | null; run_name?: string; rows: DiffRow[] }>(`/analytics/diff?${qs.toString()}`);
  },
};

/** Downloads a protected file (CSV, JSON, PDF) through the browser with the user's token. */
export async function download(path: string, filename: string): Promise<void> {
  const url = await fetchBlobUrl(path);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
