import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { benchmarksApi } from "../benchmarksApi";
import { scansApi } from "../scansApi";
import { hardeningApi, Plan, shortId } from "../hardeningApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import StatusPill from "../components/StatusPill";
import SearchBox, { matchesSearch } from "../components/SearchBox";

const field = "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";

/**
 * Step-by-step hardening: pick hosts and a source scan, review the plan (dry run), confirm, then apply.
 * The Benchmarks page opens it with a benchmark and controls already chosen.
 */
export function NewHardening({
  onClose,
  initialBenchmarkId,
  initialControlIds,
}: {
  onClose: () => void;
  initialBenchmarkId?: string;
  initialControlIds?: string[];
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const benches = useQuery({ queryKey: ["benchmarks"], queryFn: benchmarksApi.list });
  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list });
  const scans = useQuery({ queryKey: ["scans"], queryFn: scansApi.list });

  const [bid, setBid] = useState(initialBenchmarkId ?? "");
  const activeBid = bid || benches.data?.[0]?.id || "";
  const bench = benches.data?.find((b) => b.id === activeBid);
  const [hosts, setHosts] = useState<Set<number>>(new Set());
  const [scanId, setScanId] = useState("");
  const [name, setName] = useState("");
  const [controls, setControls] = useState<Set<string>>(() => new Set(initialControlIds ?? []));
  const [review, setReview] = useState<{ key: string; plan: Plan } | null>(null);
  const selectionKey = JSON.stringify([activeBid, scanId, Array.from(hosts).sort((a, b) => a - b), Array.from(controls).sort()]);
  const plan = review?.key === selectionKey ? review.plan : null;
  const [confirmRisky, setConfirmRisky] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planning, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const busy = planning || applying;
  const planRequest = useRef(0);
  const selectionRequest = useRef(0);
  useEffect(() => {
    planRequest.current++;
    selectionRequest.current++;
    setReview(null);
    setConfirmRisky(false);
    setBusy(false);
  }, [selectionKey]);

  const eligible = useMemo(() => (assets.data ?? []).filter((a) => bench && a.os_type === bench.os), [assets.data, bench]);
  const profile = useQuery({
    queryKey: ["controls", activeBid],
    queryFn: () => benchmarksApi.controls(activeBid),
    enabled: !!activeBid,
  });
  const riskyPicked = (plan?.controls ?? []).filter((c) => c.risky).length;

  // Failed controls from the chosen scan are preselected: hardening starts from a check result.
  const preselectFromScan = async () => {
    if (!scanId) return;
    const requestId = ++selectionRequest.current;
    const generation = planRequest.current;
    setError(null);
    try {
      const failed = await scansApi.results(scanId, undefined, "fail");
      if (requestId === selectionRequest.current && generation === planRequest.current) {
        setControls(new Set(failed.map((r) => r.control_id)));
      }
    } catch (err) {
      if (requestId === selectionRequest.current && generation === planRequest.current) {
        setError(err instanceof Error ? err.message : t("hard.planFailed"));
      }
    }
  };

  const doPlan = async () => {
    if (applying) return;
    const requestId = ++planRequest.current;
    setReview(null);
    setConfirmRisky(false);
    setError(null);
    setBusy(true);
    try {
      const next = await hardeningApi.plan({ benchmark_id: activeBid, control_ids: Array.from(controls), asset_ids: Array.from(hosts), scan_id: scanId || undefined });
      if (requestId === planRequest.current) setReview({ key: selectionKey, plan: next });
    } catch (err) {
      if (requestId === planRequest.current) setError(err instanceof Error ? err.message : t("hard.planFailed"));
    } finally {
      if (requestId === planRequest.current) setBusy(false);
    }
  };

  const apply = async () => {
    if (!plan || busy || (riskyPicked > 0 && !confirmRisky)) return;
    setError(null);
    setApplying(true);
    try {
      const run = await hardeningApi.create({
        name: name.trim() || undefined,
        benchmark_id: activeBid,
        control_ids: Array.from(controls),
        asset_ids: Array.from(hosts),
        scan_id: scanId || undefined,
        confirm_risky: confirmRisky,
      });
      navigate(`/hardening/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("hard.startFailed"));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-full w-full max-w-3xl space-y-4 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold">{t("hard.newRun")}</h2>
        <p className="text-sm text-slate-400">{t("hard.intro")}</p>

        <label className="block text-sm">
          <span className="text-slate-300">{t("hard.nameOpt")}</span>
          <input
            className={`${field} mt-1 w-full`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder={t("hard.namePh")}
          />
          <span className="mt-1 block text-xs text-slate-500">{t("hard.nameHint")}</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-slate-300">{t("hard.benchmark")}</span>
            <select className={`${field} mt-1 w-full`} value={activeBid} onChange={(e) => { setBid(e.target.value); setControls(new Set()); setReview(null); }}>
              {(benches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t("hard.fromScan")}</span>
            <select className={`${field} mt-1 w-full`} value={scanId} onChange={(e) => setScanId(e.target.value)}>
              <option value="">{t("hard.noScan")}</option>
              {(scans.data ?? []).filter((s) => s.benchmark_id === activeBid).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>

        <fieldset>
          <legend className="text-sm text-slate-300">{t("hard.hosts")}</legend>
          <ul className="mt-2 space-y-1">
            {eligible.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-3 rounded px-2 py-1 hover:bg-slate-800">
                  <input type="checkbox" checked={hosts.has(a.id)} onChange={() => setHosts((s) => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} />
                  <span>{a.name}</span><span className="font-mono text-xs text-slate-400">{a.host}</span>
                </label>
              </li>
            ))}
            {eligible.length === 0 && <li className="text-sm text-amber-300">{t("hard.noHosts")}</li>}
          </ul>
        </fieldset>

        <fieldset>
          <div className="flex items-center justify-between">
            <legend className="text-sm text-slate-300">{t("hard.controls")} ({controls.size} {t("hard.selected")})</legend>
            <div className="flex gap-3 text-sm">
              <button onClick={preselectFromScan} disabled={!scanId} className="text-cyan-300 hover:underline disabled:opacity-40">{t("hard.selectFailed")}</button>
              <button onClick={() => setControls(new Set((profile.data ?? []).map((c) => c.id)))} className="text-cyan-300 hover:underline">{t("hard.selectAll")}</button>
              <button onClick={() => setControls(new Set())} className="text-slate-400 hover:underline">{t("common.clear")}</button>
            </div>
          </div>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {(profile.data ?? []).map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-3 rounded px-2 py-1 text-sm hover:bg-slate-800">
                  <input type="checkbox" checked={controls.has(c.id)} onChange={() => setControls((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                  <span className="flex-1">{c.title}</span>
                  <span className="text-xs text-slate-400">{c.severity}</span>
                  {c.risky && <span className="rounded bg-red-950 px-2 py-0.5 text-xs text-red-300">{t("hard.risky")}</span>}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="flex items-center gap-3">
          <button onClick={doPlan} disabled={busy || hosts.size === 0 || controls.size === 0} className="rounded-md border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-40">
            {t("hard.dryRun")}
          </button>
          <span className="text-xs text-slate-500">{t("hard.dryNote")}</span>
        </div>

        {plan && (
          <div className="space-y-3 rounded-lg border border-slate-800 p-4 text-sm">
            <div className="font-medium">{t("hard.planSummary").replace("{c}", String(plan.controls.length)).replace("{h}", String(plan.hosts.length))}</div>
            {plan.warnings.map((w) => <p key={w} className="text-amber-300">{w}</p>)}
            <ol className="max-h-72 space-y-2 overflow-y-auto">
              {plan.controls.map((c) => (
                <li key={c.id} className="rounded bg-slate-950 p-2">
                  <div className="font-medium">{c.title} <span className="font-mono text-xs text-slate-500">{c.id}</span></div>
                  <pre className="mt-1 overflow-x-auto text-xs text-slate-300">{c.commands}</pre>
                  <div className="text-xs text-slate-500">{t("hard.backsUp")} {c.backups.join(", ") || t("hard.nothing")} Â· {t("hard.rollbackLabel")} {c.rollback}{c.reboot_required ? ` Â· ${t("hard.reboot")}` : ""}</div>
                </li>
              ))}
            </ol>
            {riskyPicked > 0 && (
              <label className="flex items-start gap-2 rounded bg-red-950/40 p-3 text-red-200">
                <input type="checkbox" className="mt-1" checked={confirmRisky} onChange={(e) => setConfirmRisky(e.target.checked)} />
                <span>{t("hard.riskyWarn").replace("{n}", String(riskyPicked))}</span>
              </label>
            )}
          </div>
        )}

        {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">{t("common.cancel")}</button>
          <button
            onClick={apply}
            disabled={!plan || busy || (riskyPicked > 0 && !confirmRisky)}
            className="rounded-md bg-amber-600 px-4 py-2 font-medium text-white hover:bg-amber-500 disabled:opacity-40"
          >
            {t("hard.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Hardening() {
  const { user } = useAuth();
  const { t } = useI18n();
  const canOperate = user?.role === "admin" || user?.role === "operator";
  const [creating, setCreating] = useState(false);
  const runs = useQuery({ queryKey: ["runs"], queryFn: hardeningApi.runs, refetchInterval: 5_000 });
  const [search, setSearch] = useState("");
  const all = runs.data ?? [];
  const shown = all.filter((r) => matchesSearch(search, [r.name, shortId("H", r.id), r.created_by, r.status.replace(/_/g, " ")]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("hard.title")}</h1>
          <p className="text-sm text-slate-400">{t("hard.subtitle")}</p>
        </div>
        {canOperate && (
          <button onClick={() => setCreating(true)} className="rounded-md bg-amber-600 px-4 py-2 font-medium text-white hover:bg-amber-500">{t("hard.newRun")}</button>
        )}
      </div>

      {(runs.data ?? []).length === 0 && <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-400">{t("hard.noRuns")}</div>}
      {all.length > 0 && (
        <SearchBox value={search} onChange={setSearch} placeholder={t("search.hardening")} shown={shown.length} total={all.length} />
      )}
      {all.length > 0 && shown.length === 0 && <p className="text-sm text-slate-400">{t("search.none")}</p>}
      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">{t("col.id")}</th>
                <th className="px-4 py-3">{t("hard.run")}</th>
                <th className="px-4 py-3">{t("col.status")}</th>
                <th className="px-4 py-3">{t("col.progress")}</th>
                <th className="px-4 py-3">{t("hard.applied")}</th>
                <th className="px-4 py-3">{t("col.started")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-slate-900/60">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{shortId("H", r.id)}</td>
                  <td className="px-4 py-3"><Link to={`/hardening/${r.id}`} className="font-medium text-cyan-300 hover:underline">{r.name}</Link></td>
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-4 py-3 text-slate-400">{Math.min(r.done_changes, r.total_changes)} / {r.total_changes}</td>
                  <td className="px-4 py-3">{r.applied_count}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{r.started_at ? new Date(r.started_at).toLocaleString() : "â€”"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewHardening onClose={() => setCreating(false)} />}
    </div>
  );
}
