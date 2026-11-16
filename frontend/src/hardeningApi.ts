import { request } from "./api";

export interface PlanControl {
  id: string;
  title: string;
  severity: string;
  risky: boolean;
  reboot_required: boolean;
  commands: string;
  backups: string[];
  rollback: string;
  rollback_command: string | null;
}

export interface Plan {
  controls: PlanControl[];
  hosts: { asset_id: number; asset_name: string; before: Record<string, { status: string; actual: string | null } | null> }[];
  warnings: string[];
}

export interface RunSummary {
  id: string;
  /** "pam" for runs applied over SSH or WinRM without an agent. */
  mode?: string;
  name: string;
  benchmark_id: string;
  scan_id: string | null;
  status: string;
  total_changes: number;
  done_changes: number;
  confirm_risky: boolean;
  host_count: number;
  applied_count: number;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  message: string | null;
}

export interface Change {
  id: number;
  asset_id: number | null;
  asset_name: string;
  host: string;
  control_id: string;
  severity: string;
  risky: boolean;
  seq: number;
  status: string;
  before_status: string | null;
  before_value: string | null;
  after_status: string | null;
  after_value: string | null;
  rollback_status: string | null;
  rollback_value: string | null;
  safety_unit: string | null;
  message: string | null;
  remediation_output: string | null;
  rollback_output: string | null;
  backups: string[];
}

export interface RunDetail extends RunSummary {
  changes: Change[];
}

/** One rollback process: a request to undo some or all applied changes of a hardening run. */
export interface RollbackProcess {
  id: string;
  /** "pam" for rollbacks of PAM runs, done by core over SSH or WinRM. */
  mode?: string;
  run_id: string;
  run_name: string;
  name: string;
  status: string;
  total: number;
  reverted: number;
  failed: number;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  message: string | null;
  legacy: boolean;
}

/**
 * Short code that tells runs with the same name apart, for example "H-3F9A2C" for a hardening run and "R-71B0D4"
 * for a rollback. It is the start of the record's own id, so it never changes.
 */
export function shortId(prefix: "H" | "R", id: string): string {
  return `${prefix}-${id.replace(/^legacy-/, "").replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export const hardeningApi = {
  rollbacks: () => request<RollbackProcess[]>("/hardening/rollbacks"),
  plan: (body: { benchmark_id: string; control_ids: string[]; asset_ids: number[]; scan_id?: string }) =>
    request<Plan>("/hardening/plan", { method: "POST", body: JSON.stringify(body) }),
  runs: () => request<RunSummary[]>("/hardening/runs"),
  run: (id: string) => request<RunDetail>(`/hardening/runs/${id}`),
  create: (body: {
    name?: string;
    benchmark_id: string;
    control_ids: string[];
    asset_ids: number[];
    scan_id?: string;
    confirm_risky: boolean;
  }) => request<RunSummary>("/hardening/runs", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) => request<RunSummary>(`/hardening/runs/${id}/cancel`, { method: "POST" }),
  rollback: (id: string, changeIds?: number[], name?: string) =>
    request<RunSummary>(`/hardening/runs/${id}/rollback`, {
      method: "POST",
      body: JSON.stringify({ change_ids: changeIds ?? null, name: name || null }),
    }),
};
