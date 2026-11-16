import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { benchmarksApi, ControlSummary, Profile } from "../benchmarksApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useFeedback } from "../components/feedback";
import { Chips } from "../components/ui";
import { NewHardening } from "./Hardening";

/** Short label that tells Windows 10, Windows 11 and Ubuntu 24.04 apart. Falls back to the OS name. */
function benchLabel(name: string, os: string): string {
  const match = name.match(/(Windows (?:Server )?\d+|Ubuntu(?: Linux)? [\d.]+)/);
  if (match) return match[1].replace(" Linux", "");
  return os === "linux" ? "Linux" : "Windows";
}

const SEVERITY_STYLE: Record<string, string> = {
  low: "bg-slate-700 text-slate-200",
  medium: "bg-amber-900/60 text-amber-200",
  high: "bg-orange-900/70 text-orange-200",
  critical: "bg-red-900/80 text-red-200",
};

function ControlRow({
  bid,
  control,
  checked,
  onToggle,
  onHarden,
}: {
  bid: string;
  control: ControlSummary;
  checked: boolean;
  onToggle: () => void;
  /** Starts a hardening run with only this control. Not given to viewers, who cannot harden. */
  onHarden?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["control", bid, control.id],
    queryFn: () => benchmarksApi.control(bid, control.id),
    enabled: open,
  });

  return (
    <>
      <tr className="align-top hover:bg-slate-900/60">
        <td className="px-3 py-2">
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`${t("bm.select")} ${control.id}`} />
        </td>
        <td className="px-3 py-2 font-mono text-xs text-slate-400">{control.cis_ref}</td>
        <td className="px-3 py-2">
          <button onClick={() => setOpen((o) => !o)} className="text-left font-medium hover:text-cyan-300">
            {control.title}
          </button>
          <div className="font-mono text-xs text-slate-500">{control.id}</div>
        </td>
        <td className="px-3 py-2 text-xs text-slate-400">{control.category}</td>
        <td className="px-3 py-2">
          <span className={`rounded px-2 py-0.5 text-xs uppercase ${SEVERITY_STYLE[control.severity]}`}>{control.severity}</span>
        </td>
        <td className="px-3 py-2 text-xs">
          {control.risky && <span className="mr-1 rounded bg-red-950 px-2 py-0.5 text-red-300">{t("hard.risky")}</span>}
          {control.reboot_required && <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">{t("bm.reboot")}</span>}
        </td>
        <td className="px-3 py-2 text-xs text-slate-400">{control.mitre_attack.join(" ")}</td>
        <td className="px-3 py-2 text-right">
          {onHarden && (
            <button
              onClick={onHarden}
              title={t("bm.hardenOneTip")}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            >
              {t("bm.hardenOne")}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-900/40">
          <td />
          <td colSpan={7} className="px-3 py-4">
            {detail.isLoading && <p className="text-slate-400">{t("common.loading")}</p>}
            {detail.data && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <p><span className="text-slate-400">{t("bm.whatItDoes")}</span> {detail.data.description}</p>
                  <p><span className="text-slate-400">{t("bm.whyMatters")}</span> {detail.data.rationale}</p>
                  <p><span className="text-slate-400">{t("bm.impact")}</span> {detail.data.impact}</p>
                </div>
                <div className="space-y-3 text-xs">
                  <div>
                    <div className="text-slate-400">{t("bm.check")} ({detail.data.audit.type}, {t("bm.expects")} {detail.data.audit.match} "{detail.data.audit.expected}")</div>
                    <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 text-slate-300">{detail.data.audit.command}</pre>
                  </div>
                  <div>
                    <div className="text-slate-400">{t("bm.fix")}</div>
                    <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 text-slate-300">{detail.data.remediation.command}</pre>
                    <div className="mt-1 text-slate-500">{t("bm.backupBefore")} {detail.data.remediation.backup.map((b) => b.type).join(", ")}</div>
                  </div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Benchmarks() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { confirm } = useFeedback();
  const canOperate = user?.role === "admin" || user?.role === "operator";

  const benches = useQuery({ queryKey: ["benchmarks"], queryFn: benchmarksApi.list });
  const [bid, setBid] = useState<string | null>(null);
  const [osTab, setOsTab] = useState<"linux" | "windows">("linux");
  // Internal native manifests are hidden here; people choose among the readable benchmarks of one OS.
  const osBenchmarks = useMemo(() => {
    const all = (benches.data ?? []).filter((b) => b.os === osTab);
    const readable = all.filter((b) => !b.id.includes("native"));
    return readable.length ? readable : all;
  }, [benches.data, osTab]);
  const activeId = bid ?? osBenchmarks[0]?.id ?? null;

  const controls = useQuery({
    queryKey: ["controls", activeId],
    queryFn: () => benchmarksApi.controls(activeId!),
    enabled: !!activeId,
  });
  const profiles = useQuery({
    queryKey: ["profiles", activeId],
    queryFn: () => benchmarksApi.profiles(activeId!),
    enabled: !!activeId,
  });

  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profileName, setProfileName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // Control ids to harden; null while the hardening window is closed.
  const [hardening, setHardening] = useState<string[] | null>(null);

  const categories = useMemo(
    () => Array.from(new Set((controls.data ?? []).map((c) => c.category))).sort(),
    [controls.data],
  );

  const visible = (controls.data ?? []).filter(
    (c) =>
      (!severity || c.severity === severity) &&
      (!category || c.category === category) &&
      (!search || `${c.title} ${c.id} ${c.cis_ref}`.toLowerCase().includes(search.toLowerCase())),
  );

  const applyProfile = (p: Profile) => setSelected(new Set(p.control_ids));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const saveProfile = useMutation({
    mutationFn: () => benchmarksApi.createProfile(activeId!, profileName.trim(), Array.from(selected)),
    onSuccess: (p) => {
      setMessage(t("bm.saved").replace("{name}", p.name).replace("{n}", String(p.control_ids.length)));
      setProfileName("");
      queryClient.invalidateQueries({ queryKey: ["profiles", activeId] });
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : t("bm.saveFail")),
  });

  const removeProfile = useMutation({
    mutationFn: (pid: string) => benchmarksApi.deleteProfile(activeId!, pid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles", activeId] }),
  });

  const field = "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("bm.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("bm.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chips
            label="operating system"
            value={osTab}
            onChange={(v) => { setOsTab(v); setBid(null); setSelected(new Set()); }}
            options={[{ id: "linux", label: "Linux" }, { id: "windows", label: "Windows" }]}
          />
          <select
            className={field}
            aria-label="benchmark"
            value={activeId ?? ""}
            onChange={(e) => { setBid(e.target.value); setSelected(new Set()); }}
          >
            {osBenchmarks.map((b) => <option key={b.id} value={b.id}>{benchLabel(b.name, b.os)} · {b.control_count}</option>)}
          </select>
        </div>
      </div>

      {controls.error && <p className="text-red-400">{t("bm.loadError")}: {(controls.error as Error).message}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <select className={field} value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="severity filter">
          <option value="">{t("bm.allSev")}</option>
          <option value="critical">{t("sev.critical")}</option>
          <option value="high">{t("sev.high")}</option>
          <option value="medium">{t("sev.medium")}</option>
          <option value="low">{t("sev.low")}</option>
        </select>
        <select className={field} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="category filter">
          <option value="">{t("bm.allCat")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input className={`${field} min-w-64 flex-1`} placeholder={t("bm.searchPh")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-sm text-slate-400">
          {visible.length} {t("bm.shown")} · {selected.size} {t("bm.selected")}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <span className="text-sm text-slate-300">{t("bm.profile")}</span>
        {(profiles.data ?? []).map((p) => (
          <span key={p.id} className="flex items-center gap-1">
            <button
              onClick={() => applyProfile(p)}
              className="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
              title={p.description}
            >
              {p.name} ({p.control_ids.length})
            </button>
            {!p.builtin && canOperate && (
              <button
                onClick={async () => (await confirm({ title: t("bm.delProfile").replace("{name}", p.name), confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true })) && removeProfile.mutate(p.id)}
                className="text-xs text-red-400 hover:underline"
                aria-label={`${t("common.delete")} ${p.name}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button onClick={() => setSelected(new Set())} className="text-sm text-slate-400 hover:text-slate-200">
          {t("bm.clearSel")}
        </button>
        {canOperate && (
          <div className="ml-auto flex items-center gap-2">
            <input
              className={field}
              placeholder={t("bm.nameSel")}
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              aria-label="profile name"
            />
            <button
              onClick={() => saveProfile.mutate()}
              disabled={!profileName.trim() || selected.size === 0 || saveProfile.isPending}
              className="rounded-md bg-cyan-600 px-3 py-2 text-sm text-white hover:bg-cyan-500 disabled:opacity-40"
            >
              {t("bm.saveProfile")}
            </button>
          </div>
        )}
      </div>
      {message && <p className="text-sm text-emerald-300">{message}</p>}

      <div className="flex flex-wrap gap-3 text-sm">
        <button onClick={() => setSelected(new Set(visible.map((c) => c.id)))} className="text-cyan-300 hover:underline">
          {t("bm.selectAllShown")}
        </button>
        <span className="text-slate-500">{t("bm.hint")}</span>
        {canOperate && (
          <button
            onClick={() => setHardening(Array.from(selected))}
            disabled={selected.size === 0}
            title={t("bm.hardenSelTip")}
            className="ml-auto rounded-md bg-cyan-600 px-3 py-1.5 font-medium hover:bg-cyan-500 disabled:opacity-40"
          >
            {t("bm.hardenSel")} ({selected.size})
          </button>
        )}
      </div>

      {controls.isLoading && <p className="text-slate-400">{t("common.loading")}</p>}
      {visible.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-3 py-3" />
                <th className="px-3 py-3">{t("bm.cis")}</th>
                <th className="px-3 py-3">{t("col.control")}</th>
                <th className="px-3 py-3">{t("bm.category")}</th>
                <th className="px-3 py-3">{t("col.severity")}</th>
                <th className="px-3 py-3">{t("bm.flags")}</th>
                <th className="px-3 py-3">ATT&amp;CK</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {visible.map((c) => (
                <ControlRow
                  key={c.id}
                  bid={activeId!}
                  control={c}
                  checked={selected.has(c.id)}
                  onToggle={() => toggle(c.id)}
                  onHarden={canOperate ? () => setHardening([c.id]) : undefined}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hardening && activeId && (
        <NewHardening onClose={() => setHardening(null)} initialBenchmarkId={activeId} initialControlIds={hardening} />
      )}
    </div>
  );
}
