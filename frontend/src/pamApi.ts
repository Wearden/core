import { request } from "./api";
import type { BenchmarkSummary } from "./benchmarksApi";
import type { RunDetail } from "./hardeningApi";
import type { ScanDetail } from "./scansApi";

/** Result of a PAM connection test. confirm_host_key asks the operator to trust the SSH host key first. */
export interface PamTestResult {
  status: "ok" | "failed" | "confirm_host_key";
  detail?: string;
  os_detected?: string;
  privilege?: string;
  latency_ms?: number;
  host_key?: string;
  host_key_type?: string;
  host_key_changed?: boolean;
}

export const pamApi = {
  benchmarks: () => request<BenchmarkSummary[]>("/pam/benchmarks"),
  test: (assetId: number, hostKey = "", replaceHostKey = false) =>
    request<PamTestResult>(`/pam/assets/${assetId}/test`, { method: "POST", body: JSON.stringify({ host_key: hostKey, replace_host_key: replaceHostKey }) }),
  scan: (body: { name?: string; benchmark_id: string; profile_id: string; asset_ids: number[] }) =>
    request<ScanDetail>("/pam/scans", { method: "POST", body: JSON.stringify(body) }),
  harden: (body: { name?: string; benchmark_id: string; asset_ids: number[]; rule_ids: string[]; confirm_risky: boolean; scan_id: string | null }) =>
    request<RunDetail>("/pam/hardening", { method: "POST", body: JSON.stringify(body) }),
};
