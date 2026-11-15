import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, EnrollmentToken } from "../agentsApi";
import { benchmarksApi } from "../benchmarksApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

const field = "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm";

export default function AgentManagement() {
  const { user } = useAuth();
  const { lang, t } = useI18n();
  const az = lang === "az";
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const agents = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list, refetchInterval: 10_000 });
  const benchmarks = useQuery({ queryKey: ["benchmarks"], queryFn: benchmarksApi.list, enabled: isAdmin });
  const [os, setOs] = useState<"linux" | "windows">("linux");
  const [benchmarkId, setBenchmarkId] = useState("");
  const [ttl, setTtl] = useState(15);
  const [token, setToken] = useState<EnrollmentToken | null>(null);
  const eligible = (benchmarks.data ?? []).filter((b) => b.os === os);
  const activeBenchmark = eligible.find((b) => b.id === benchmarkId)?.id ?? eligible[0]?.id ?? "";
  const enroll = useMutation({ mutationFn: agentsApi.enroll, onSuccess: setToken });
  const revoke = useMutation({
    mutationFn: agentsApi.revoke,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setToken(null);
    enroll.mutate({ os, benchmark_id: activeBenchmark, ttl_minutes: ttl });
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="font-semibold">{az ? "Agentlər" : "Agents"}</h2>
      <p className="text-sm text-slate-400">{az ? "Skan və möhkəmləndirmə qeydiyyatdan keçmiş agentlərdə icra olunur. SSH/RDP sessiyaları ayrıca etimad məlumatı tələb edir." : "Scans and hardening run on enrolled agents. SSH/RDP sessions require separate credentials."}</p>
      {isAdmin && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">OS
            <select className={field} value={os} onChange={(e) => { setOs(e.target.value as typeof os); setBenchmarkId(""); setToken(null); }}>
              <option value="linux">Linux</option><option value="windows">Windows</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">Benchmark
            <select required className={field} value={activeBenchmark} onChange={(e) => { setBenchmarkId(e.target.value); setToken(null); }}>
              <option value="" disabled>{az ? "Benchmark seçin" : "Select benchmark"}</option>
              {eligible.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">{az ? "Müddət (dəqiqə)" : "TTL (minutes)"}
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
          <code className="block break-all select-all">{token.token}</code>
          <button className="text-cyan-300 hover:underline" onClick={() => setToken(null)}>{az ? "Gizlət" : "Hide"}</button>
        </div>
      )}
      {[agents.error, benchmarks.error, enroll.error, revoke.error].filter(Boolean).map((error, i) => <p key={i} role="alert" className="text-sm text-red-400">{(error as Error).message}</p>)}
      {agents.isLoading && <p className="text-sm text-slate-400">{t("common.loading")}</p>}
      {!agents.isLoading && !agents.error && agents.data?.length === 0 && <p className="text-sm text-slate-400">{az ? "Qeydiyyatdan keçmiş agent yoxdur." : "No enrolled agents."}</p>}
      {!!agents.data?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400"><tr><th className="p-2">Host</th><th className="p-2">OS</th><th className="p-2">Benchmark</th><th className="p-2">{t("col.status")}</th><th className="p-2">{az ? "Son əlaqə" : "Last seen"}</th>{isAdmin && <th className="p-2">{t("col.actions")}</th>}</tr></thead>
            <tbody>{agents.data?.map((agent) => <tr key={agent.id} className="border-t border-slate-800">
              <td className="p-2">{agent.hostname}</td><td className="p-2">{agent.os}</td><td className="p-2">{agent.benchmark_id}</td><td className="p-2">{agent.status}</td><td className="p-2">{agent.last_seen ?? "-"}</td>
              {isAdmin && <td className="p-2"><button disabled={agent.status === "revoked" || revoke.isPending} className="rounded border border-red-900 px-2 py-1 text-red-400 disabled:opacity-40" onClick={() => window.confirm(az ? `${agent.hostname} agentinin girişini ləğv etmək?` : `Revoke access for ${agent.hostname}?`) && revoke.mutate(agent.id)}>{az ? "Girişi ləğv et" : "Revoke"}</button></td>}
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
