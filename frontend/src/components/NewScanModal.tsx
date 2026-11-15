import { FormEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { benchmarksApi } from "../benchmarksApi";
import { scansApi, ScanDetail } from "../scansApi";
import { useI18n } from "../i18n";

interface Props {
  onCreated: (scan: ScanDetail) => void;
  onClose: () => void;
}

const field = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";

export default function NewScanModal({ onCreated, onClose }: Props) {
  const { t } = useI18n();
  const benches = useQuery({ queryKey: ["benchmarks"], queryFn: benchmarksApi.list });
  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list });
  const [bid, setBid] = useState("");
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeBid = bid || benches.data?.[0]?.id || "";
  const bench = benches.data?.find((b) => b.id === activeBid);
  const profiles = useQuery({
    queryKey: ["profiles", activeBid],
    queryFn: () => benchmarksApi.profiles(activeBid),
    enabled: !!activeBid,
  });
  const activeProfile = profileId || profiles.data?.[0]?.id || "";

  // Only hosts of the benchmark's OS can be scanned with it.
  const eligible = useMemo(
    () => (assets.data ?? []).filter((a) => bench && a.os_type === bench.os),
    [assets.data, bench],
  );

  const toggle = (id: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const scan = await scansApi.create({
        name: name.trim() || undefined,
        benchmark_id: activeBid,
        profile_id: activeProfile,
        asset_ids: Array.from(picked),
      });
      onCreated(scan);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("scan.startFail"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="max-h-full w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold">{t("scan.newTitle")}</h2>
        <p className="text-sm text-slate-400">{t("scan.newNote")}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-slate-300">{t("hard.benchmark")}</span>
            <select className={field} value={activeBid} onChange={(e) => { setBid(e.target.value); setProfileId(""); setPicked(new Set()); }}>
              {(benches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t("scan.profile")}</span>
            <select className={field} value={activeProfile} onChange={(e) => setProfileId(e.target.value)}>
              {(profiles.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.control_ids.length})</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-slate-300">{t("scan.nameOpt")}</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t("scan.namePh")} />
        </label>

        <fieldset>
          <legend className="text-sm text-slate-300">{t("col.hosts")} ({picked.size} {t("hard.selected")})</legend>
          {eligible.length === 0 && (
            <p className="mt-2 text-sm text-amber-300">
              {t("scan.noAssets").replace("{os}", bench?.os ?? "")}
            </p>
          )}
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {eligible.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-3 rounded px-2 py-1 hover:bg-slate-800">
                  <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                  <span className="font-medium">{a.name}</span>
                  <span className="font-mono text-xs text-slate-400">{a.host}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={saving || picked.size === 0 || !activeProfile}
            className="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
          >
            {saving ? t("scan.starting") : t("scan.start")}
          </button>
        </div>
      </form>
    </div>
  );
}
