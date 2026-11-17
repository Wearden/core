import { FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, EnrollmentToken } from "../agentsApi";
import { benchmarksApi } from "../benchmarksApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useFeedback } from "./feedback";
import HostIcon, { osLabel } from "./HostIcon";
import { dateTime } from "../time";

const field = "max-w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-400";

export default function AgentManagement() {
  const { can } = useAuth();
  const { lang, t } = useI18n();
  const az = lang === "az";
  const isAdmin = can("agents.enroll");
  const queryClient = useQueryClient();
  const { confirm, toast } = useFeedback();
  const agents = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list, refetchInterval: 10_000 });
  const benchmarks = useQuery({ queryKey: ["benchmarks"], queryFn: benchmarksApi.list, enabled: isAdmin });
  const [os, setOs] = useState<"linux" | "windows">("linux");
  const [benchmarkId, setBenchmarkId] = useState("");
  const [ttl, setTtl] = useState(15);
  const [, setParams] = useSearchParams();
  const openDrawer = (id: number | undefined, tab: "overview" | "logs") => id !== undefined && setParams({ host: String(id), tab });
  const [remediation, setRemediation] = useState(false);
  const install = useQuery({ queryKey: ["install-info"], queryFn: agentsApi.installInfo });
  const [token, setToken] = useState<EnrollmentToken | null>(null);
  const eligible = (benchmarks.data ?? []).filter((b) => b.os === os);
  const activeBenchmark = eligible.find((b) => b.id === benchmarkId)?.id ?? eligible[0]?.id ?? "";
  const enroll = useMutation({ mutationFn: agentsApi.enroll, onSuccess: setToken });
  const revoke = useMutation({
    mutationFn: agentsApi.revoke,
    onSuccess: () => { toast(az ? "Agentin girişi ləğv edildi." : "Agent access revoked.", "success"); return queryClient.invalidateQueries({ queryKey: ["agents"] }); },
    onError: (e) => toast((e as Error).message, "error"),
  });
  // Online workstations first, then alphabetical, so the list stays predictable.
  const sorted = [...(agents.data ?? [])].sort((a, b) => Number(b.status === "online") - Number(a.status === "online") || a.hostname.localeCompare(b.hostname));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setToken(null);
    enroll.mutate({ os, benchmark_id: activeBenchmark, ttl_minutes: ttl });
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <h2 className="font-semibold">{az ? "Agentlər" : "Agents"}</h2>
      <p className="text-sm text-slate-400">{az ? "Skan və möhkəmləndirmə qeydiyyatdan keçmiş agentlərdə icra olunur. SSH/RDP sessiyaları ayrıca etimad məlumatı tələb edir." : "Scans and hardening run on enrolled agents. SSH/RDP sessions require separate credentials."}</p>
      {[agents.error, benchmarks.error, enroll.error, revoke.error].filter(Boolean).map((error, i) => <p key={i} role="alert" className="text-sm text-red-400">{(error as Error).message}</p>)}
      {agents.isLoading && <p className="text-sm text-slate-400">{t("common.loading")}</p>}
      {!agents.isLoading && !agents.error && agents.data?.length === 0 && <p className="text-sm text-slate-400">{az ? "Qeydiyyatdan keçmiş agent yoxdur." : "No enrolled agents."}</p>}
      {!!sorted.length && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((agent) => (
            <li key={agent.id} className="cursor-pointer rounded-xl border border-slate-800 bg-slate-950 p-4 transition-colors hover:border-slate-600" onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) openDrawer(agent.asset_id, "overview"); }}>
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2"><HostIcon os={agent.os} size={32} title={osLabel(agent.os)} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-50">{agent.hostname}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${agent.status === "online" ? "bg-emerald-400" : agent.status === "revoked" ? "bg-red-400" : "bg-slate-500"}`} />
                      {agent.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">{osLabel(agent.os)} · {agent.benchmark_id}</div>
                  <div className="text-xs text-slate-500">{az ? "Son əlaqə" : "Last seen"}: {agent.last_seen ? dateTime(agent.last_seen) : "-"}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                <div className="flex gap-2">
                  <button className="rounded-md border border-slate-800 px-2.5 py-1 text-slate-300 hover:bg-slate-900" onClick={() => openDrawer(agent.asset_id, "overview")}>{az ? "Detallar" : "Details"}</button>
                  <button className="rounded-md border border-slate-800 px-2.5 py-1 text-slate-300 hover:bg-slate-900" onClick={() => openDrawer(agent.asset_id, "logs")}>{az ? "Loglar" : "Logs"}</button>
                </div>
                {isAdmin && (
                  <button disabled={agent.status === "revoked" || revoke.isPending} className="rounded-md border border-slate-800 px-2.5 py-1 text-red-300 hover:bg-slate-900 disabled:opacity-40" onClick={async () => (await confirm({ title: az ? `${agent.hostname} agentinin girişi ləğv edilsin?` : `Revoke access for ${agent.hostname}?`, message: az ? "Agent bir daha core ilə əlaqə qura bilməyəcək." : "The agent will no longer be able to talk to core.", confirmLabel: az ? "Ləğv et" : "Revoke", cancelLabel: az ? "Vaz keç" : "Keep", danger: true })) && revoke.mutate(agent.id)}>
                    {az ? "Girişi ləğv et" : "Revoke"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <details className="rounded-xl border border-slate-800 bg-slate-950 p-4">
          <summary className="text-sm font-medium text-slate-200">{az ? "Yeni agent qeydiyyatdan keçir" : "Enroll a new agent"}</summary>
          <div className="mt-4 space-y-4">
      {isAdmin && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:w-auto">OS
            <select className={field} value={os} onChange={(e) => { setOs(e.target.value as typeof os); setBenchmarkId(""); setToken(null); }}>
              <option value="linux">Linux</option><option value="windows">Windows</option>
            </select>
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:w-auto">Benchmark
            <select required className={field} value={activeBenchmark} onChange={(e) => { setBenchmarkId(e.target.value); setToken(null); }}>
              <option value="" disabled>{az ? "Benchmark seçin" : "Select benchmark"}</option>
              {eligible.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:w-auto">{az ? "Müddət (dəqiqə)" : "TTL (minutes)"}
            <input required type="number" min={1} step={1} className={`${field} w-28`} value={ttl} onChange={(e) => { setTtl(Number(e.target.value)); setToken(null); }} />
          </label>
          <button disabled={!activeBenchmark || !Number.isInteger(ttl) || ttl < 1 || enroll.isPending} className="rounded-md bg-cyan-600 px-4 py-2 text-sm disabled:opacity-40">
            {enroll.isPending ? t("common.loading") : az ? "Qeydiyyat tokeni yarat" : "Create enrollment token"}
          </button>
        </form>
      )}
      {token && isAdmin && (
        <div className="space-y-2 rounded-md border border-amber-800 bg-slate-950 p-3 text-sm">
          <p>{az ? "Bu tokeni yalnız agentin quraşdırılması üçün istifadə edin. Bitmə vaxtı:" : "Use this token only to enroll the agent. Expires:"} {token.expires_at}</p>
          {os === "linux" && install.data?.linux_available && (
            <>
              <p className="text-slate-400">{az ? "Agenti maşında bu tək əmrlə qurun (root lazımdır):" : "Install the agent on the machine with this single command (root required):"}</p>
              <code className="block break-all select-all rounded-md border border-slate-800 bg-slate-900 p-3 text-xs">
                {`curl -fsSL ${window.location.origin}/install-agent.sh | sudo sh -s -- --token ${token.token}${remediation ? " --allow-remediation" : ""}`}
              </code>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={remediation} onChange={(e) => setRemediation(e.target.checked)} />
                {az ? "Bu agentdə təsdiqlənmiş möhkəmləndirməyə icazə ver" : "Allow confirmed hardening on this agent"}
              </label>
            </>
          )}
          {!(os === "linux" && install.data?.linux_available) && <code className="block break-all select-all">{token.token}</code>}
          <button className="text-cyan-300 hover:underline" onClick={() => setToken(null)}>{az ? "Gizlət" : "Hide"}</button>
        </div>
      )}
          </div>
        </details>
      )}
    </section>
  );
}
