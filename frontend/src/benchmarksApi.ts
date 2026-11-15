import { request } from "./api";

export interface BenchmarkSummary {
  id: string;
  os: "linux" | "windows";
  name: string;
  version: string;
  control_count: number;
}

export interface ControlSummary {
  id: string;
  cis_ref: string;
  title: string;
  os: string;
  category: string;
  level: number;
  severity: "low" | "medium" | "high" | "critical";
  risky: boolean;
  reboot_required: boolean;
  mitre_attack: string[];
}

export interface ControlDetail extends ControlSummary {
  description: string;
  rationale: string;
  impact: string;
  audit: { type: string; command: string; expected: string; match: string };
  remediation: { backup: { type: string; path: string | null; name: string | null }[]; command: string };
  rollback: { strategy: string; command: string | null };
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  control_ids: string[];
}

export const benchmarksApi = {
  list: () => request<BenchmarkSummary[]>("/benchmarks"),
  controls: (bid: string) => request<ControlSummary[]>(`/benchmarks/${bid}/controls`),
  control: (bid: string, cid: string) => request<ControlDetail>(`/benchmarks/${bid}/controls/${cid}`),
  profiles: (bid: string) => request<Profile[]>(`/benchmarks/${bid}/profiles`),
  createProfile: (bid: string, name: string, control_ids: string[]) =>
    request<Profile>(`/benchmarks/${bid}/profiles`, { method: "POST", body: JSON.stringify({ name, control_ids }) }),
  deleteProfile: (bid: string, pid: string) => request<void>(`/benchmarks/${bid}/profiles/${pid}`, { method: "DELETE" }),
};
