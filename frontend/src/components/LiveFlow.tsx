import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { getPrefs } from "../prefs";
import type { ScanDetail } from "../scansApi";
import type { LiveCheck } from "../hooks/useScanSocket";
import type { LogLine } from "../hooks/useHardeningSocket";
import type { Change, RunSummary } from "../hardeningApi";
import CallChip, { CallChipStatus } from "./CallChip";

type StepState = "idle" | "active" | "done" | "fail" | "stop";
/** What the side panel shows when a box, host or log line is clicked. */
interface Detail { title: string; rows: [string, string][]; note?: string }
interface Step { label: string; detail?: string; info: Detail }
interface Line { key: string; text: string; tone?: "ok" | "bad" | "warn"; info?: Detail }
/** One unit of work shown as a CallChip: a check on a host, or a hardening change. */
interface Call { key: string; name: string; arg: string; status: CallChipStatus; info: Detail }
// CallChip colours matched to the app's dark palette.
const CHIP = { surfaceColor: "#0f172a", color: "#e2e8f0", progressColor: "#22d3ee", doneColor: "#10b981", errorColor: "#ef4444" } as const;
interface Stat { label: string; value: string | number; tone: "ok" | "bad" | "warn" | "plain" }
const STAT_TONE = { ok: "text-emerald-300", bad: "text-red-300", warn: "text-amber-300", plain: "text-white" };
const DOTS = { backgroundColor: "#050505", backgroundImage: "radial-gradient(rgba(255,255,255,.11) 1px, transparent 1px)", backgroundSize: "18px 18px" };
interface Chip { key: string; label: string; ok: number; bad: number; warn: number; info: Detail }

const NODE: Record<StepState, string> = {
  idle: "border-slate-700 bg-slate-900 text-slate-500",
  active: "wf-anim wf-pulse border-cyan-500 bg-cyan-950/50 text-cyan-100",
  done: "border-emerald-700 bg-emerald-950/40 text-emerald-200",
  fail: "border-red-600 bg-red-950/50 text-red-200",
  stop: "border-amber-600 bg-amber-950/40 text-amber-200",
};
const ARROW: Record<StepState, string> = { idle: "#475569", active: "#22d3ee", done: "#059669", fail: "#dc2626", stop: "#d97706" };
const TONE = { ok: "text-emerald-300", bad: "text-red-300", warn: "text-amber-300" };

// Keyframes live here so the component needs no Tailwind config change. Motion is off for reduced-motion users.
const CSS = `@keyframes wf-dash{to{stroke-dashoffset:-16}}
@keyframes wf-pulse{0%,100%{box-shadow:0 0 0 0 rgba(34,211,238,.45)}50%{box-shadow:0 0 0 10px rgba(34,211,238,0)}}
@keyframes wf-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.wf-pulse{animation:wf-pulse 1.6s ease-in-out infinite}.wf-flow{animation:wf-dash .7s linear infinite}.wf-line{animation:wf-in .25s ease-out}
@media (prefers-reduced-motion:reduce){.wf-anim,.wf-flow,.wf-line{animation:none!important}}`;

function stateOf(i: number, current: number, end: "ok" | "fail" | "stop" | null): StepState {
  if (end === "ok" || i < current) return "done";
  if (i > current) return "idle";
  return end === "fail" ? "fail" : end === "stop" ? "stop" : "active";
}

function Arrow({ flowing, color }: { flowing: boolean; color: string }) {
  return (
    <svg viewBox="0 0 48 14" className="h-5 w-16 shrink-0" aria-hidden="true">
      <line x1="2" y1="7" x2="38" y2="7" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={flowing ? "4 4" : undefined} className={flowing ? "wf-flow" : undefined} />
      <polygon points="36,2 47,7 36,12" fill={color} />
    </svg>
  );
}

// Colour a value by what it says: good green, bad red, in progress yellow, numbers white, the rest grey.
const toneOf = (v: string) =>
  /^(pass|passed|done|ok|completed|applied|connected|yes|bəli)\b/i.test(v) ? "text-emerald-300"
  : /^(fail|failed|error|errored|cancelled|no|xeyr)\b/i.test(v) ? "text-red-300"
  : /^(running|queued|pending|idle|cancel_requested)\b/i.test(v) ? "text-amber-300"
  : /^[\d\s/%.()-]+$/.test(v) ? "font-semibold text-white" : "text-slate-300";

/** Small window under a pipeline box with that stage's details, coloured by meaning. */
function StepPopover({ detail, alignRight }: { detail: Detail; alignRight: boolean }) {
  return (
    <div role="dialog" aria-label={detail.title} className={`absolute top-full z-20 mt-2 w-72 rounded-lg border border-slate-700 bg-black p-3 text-xs shadow-2xl ${alignRight ? "right-0" : "left-0"}`}>
      <span aria-hidden className={`absolute -top-1.5 h-3 w-3 rotate-45 border-l border-t border-slate-700 bg-black ${alignRight ? "right-6" : "left-6"}`} />
      <div className="mb-2 text-sm font-semibold text-white">{detail.title}</div>
      <dl className="space-y-1">
        {detail.rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="shrink-0 text-slate-500">{k}</dt>
            <dd className={`min-w-0 break-words text-right font-mono ${toneOf(v)}`}>{v || "-"}</dd>
          </div>
        ))}
      </dl>
      {detail.note && <p className="mt-2 border-t border-slate-800 pt-2 text-slate-400">{detail.note}</p>}
    </div>
  );
}

/** Large window: coloured boxes joined by arrows (the active one pulses, the arrow into it flows). Click anything for details. */
function LiveFlow({ title, steps, current, end, lines, chips, calls, callsTitle, headline, stats, progress, live, summary }: { title: string; steps: Step[]; current: number; end: "ok" | "fail" | "stop" | null; lines: Line[]; chips?: Chip[]; calls?: Call[]; callsTitle?: string; headline?: Call; stats?: Stat[]; progress?: number; live: boolean; summary: string }) {
  const { lang } = useI18n();
  const az = lang === "az";
  const [open, setOpen] = useState(() => live && getPrefs().liveAutoOpen);
  const [sel, setSel] = useState<{ id: string; detail: Detail } | null>(null);
  useEffect(() => { if (live && getPrefs().liveAutoOpen) setOpen(true); }, [live]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const dot = live ? "wf-anim wf-pulse bg-cyan-400" : end === "fail" ? "bg-red-500" : end === "stop" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <>
      <style>{CSS}</style>
      <button onClick={() => setOpen(true)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-left text-sm hover:bg-slate-800">
        <span className="flex items-center gap-3 text-slate-200"><span className={`h-2.5 w-2.5 rounded-full ${dot}`} />{title}<span className="text-xs text-slate-500">{summary}</span></span>
        <span className="text-xs text-cyan-300">{az ? "Canlı axını aç" : "Open live flow"}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="flex h-[min(92vh,54rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <div className="flex items-center gap-3 text-sm font-semibold text-slate-50"><span className={`h-3 w-3 rounded-full ${dot}`} />{title}<span className="text-xs font-normal text-slate-500">{summary}</span></div>
              {headline && <CallChip {...CHIP} size={28} icon={headline.name === "harden" ? "edit" : "search"} name={headline.name} argument={headline.arg} status={headline.status} expectedMs={90000} />}
              <button onClick={() => setOpen(false)} aria-label={az ? "Bağla" : "Close"} className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800">Esc</button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-8" style={DOTS}>
                {stats && stats.length > 0 && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {stats.map((t) => (
                        <div key={t.label} className="rounded-xl border border-slate-800 bg-black/70 px-4 py-3">
                          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{t.label}</div>
                          <div className={`mt-1 text-3xl font-semibold tabular-nums ${STAT_TONE[t.tone]}`}>{t.value}</div>
                        </div>
                      ))}
                    </div>
                    {progress !== undefined && (
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                          <div className={`h-full rounded-full transition-all duration-700 ${end === "fail" ? "bg-red-500" : end === "stop" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${progress}%` }} />
                        </div>
                        <span className="w-10 text-right text-xs tabular-nums text-slate-400">{progress}%</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center">
                  {steps.map((s, i) => {
                    const st = stateOf(i, current, end);
                    const id = `step-${i}`;
                    return (
                      <div key={s.label} className="flex min-w-0 flex-1 items-center">
                        {i > 0 && <Arrow flowing={st === "active" && end === null} color={ARROW[st]} />}
                        <div className="relative min-w-0 flex-1">
                        <button onClick={() => setSel(sel?.id === id ? null : { id, detail: s.info })} aria-pressed={sel?.id === id} className={`w-full rounded-2xl border-2 px-5 py-5 text-left text-base transition-colors duration-500 hover:brightness-125 ${NODE[st]} ${sel?.id === id ? "ring-2 ring-white/40" : ""}`}>
                          <span className="flex items-center gap-2 font-medium">
                            {st === "active" ? <span className="wf-anim h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" /> : <span>{st === "done" ? "✓" : st === "fail" ? "✕" : st === "stop" ? "■" : "○"}</span>}
                            {s.label}
                          </span>
                          {s.detail && <span className="mt-1.5 block text-sm opacity-80">{s.detail}</span>}
                        </button>
                        {sel?.id === id && <StepPopover detail={s.info} alignRight={i >= steps.length - 2} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {calls && calls.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{callsTitle}</div>
                    <div className="flex flex-wrap gap-2">
                      {calls.map((c) => {
                        const id = `call-${c.key}`;
                        return (
                          <span key={c.key} className="relative block"><button onClick={() => setSel(sel?.id === id ? null : { id, detail: c.info })} aria-pressed={sel?.id === id} className={`rounded-lg ${sel?.id === id ? "ring-2 ring-white/40" : ""}`}>
                            <CallChip {...CHIP} size={36} icon={headline?.name === "harden" ? "edit" : "search"} showTimer={false} expectedMs={1} name={c.name} argument={c.arg} status={c.status} />
                          </button>{sel?.id === id && <StepPopover detail={c.info} alignRight={false} />}</span>
                        );
                      })}
                    </div>
                  </div>
                )}
                {chips && chips.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{az ? "Hostlar" : "Hosts"} <span className="normal-case">({az ? "keçdi / uğursuz / xəta" : "pass / fail / error"})</span></div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {chips.map((c) => {
                        const total = Math.max(c.ok + c.bad + c.warn, 1);
                        const id = `chip-${c.key}`;
                        return (
                          <span key={c.key} className="relative block"><button onClick={() => setSel(sel?.id === id ? null : { id, detail: c.info })} aria-pressed={sel?.id === id} className={`rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-left text-sm text-slate-300 hover:border-slate-600 ${sel?.id === id ? "ring-2 ring-white/40" : ""}`}>
                            <span className="mb-2 flex justify-between"><span className="truncate">{c.label}</span><span className="text-xs text-slate-500">{c.ok}/{c.bad}/{c.warn}</span></span>
                            <span className="flex h-2 overflow-hidden rounded bg-slate-800">
                              <span className="bg-emerald-500 transition-all duration-500" style={{ width: `${(c.ok / total) * 100}%` }} />
                              <span className="bg-red-500 transition-all duration-500" style={{ width: `${(c.bad / total) * 100}%` }} />
                              <span className="bg-amber-500 transition-all duration-500" style={{ width: `${(c.warn / total) * 100}%` }} />
                            </span>
                          </button>{sel?.id === id && <StepPopover detail={c.info} alignRight={false} />}</span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <ul className="max-h-44 shrink-0 space-y-0.5 overflow-y-auto border-t border-slate-800 bg-black/40 px-5 py-3 font-mono text-xs" aria-live="off">
              {lines.length === 0 && <li className="text-slate-600">{az ? "Hadisə gözlənilir…" : "Waiting for events…"}</li>}
              {lines.map((l) => (
                <li key={l.key} className="wf-line">
                  <span className={`block w-full truncate text-left ${l.tone ? TONE[l.tone] : "text-slate-400"} `}>{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

const fmt = (v: unknown) => (v == null ? "" : String(v));

/** Scan pipeline from the scan record and the live check feed. */
export function ScanFlow({ scan, feed }: { scan: ScanDetail; feed: LiveCheck[] }) {
  const { lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const running = scan.status === "running" || scan.status === "cancel_requested";
  const hasHosts = scan.hosts.length > 0;
  const current = scan.status === "queued" ? 0 : !hasHosts && running ? 1 : 2;
  const end = scan.status === "completed" ? "ok" : scan.status === "failed" ? "fail" : scan.status === "cancelled" ? "stop" : null;
  const scored = scan.hosts.filter((h) => h.score != null);
  const avg = scored.length ? Math.round(scored.reduce((a, h) => a + (h.score ?? 0), 0) / scored.length) : null;
  const sum = (k: "passed" | "failed" | "errored") => scan.hosts.reduce((a, h) => a + h[k], 0);
  const pct = scan.total_checks ? Math.round((scan.done_checks / scan.total_checks) * 100) : 0;
  const steps: Step[] = [
    { label: L("Queued", "Növbədə"), info: { title: L("Queued", "Növbədə"), rows: [[L("Scan", "Skan"), scan.name], [L("Profile", "Profil"), scan.profile_name], ["Benchmark", scan.benchmark_id], [L("Status", "Status"), scan.status]], note: L("The scan waits for an enrolled agent to pick it up on its next heartbeat.", "Skan qeydiyyatlı agentin növbəti heartbeat-də onu götürməsini gözləyir.") } },
    { label: L("Agent connected", "Agent qoşuldu"), detail: hasHosts ? `${scan.hosts.length} ${L("host(s)", "host")}` : undefined, info: { title: L("Agent connected", "Agent qoşuldu"), rows: scan.hosts.map((h) => [h.asset_name || h.host, `${fmt(h.os_detected)} · ${h.status}`] as [string, string]), note: hasHosts ? undefined : L("No agent has picked the scan up yet.", "Hələ heç bir agent skanı götürməyib.") } },
    { label: L("Running checks", "Yoxlamalar"), detail: `${scan.done_checks}/${scan.total_checks}`, info: { title: L("Running checks", "Yoxlamalar"), rows: [[L("Progress", "Gediş"), `${scan.done_checks} / ${scan.total_checks} (${pct}%)`], [L("Passed", "Keçdi"), String(sum("passed"))], [L("Failed", "Uğursuz"), String(sum("failed"))], [L("Errors", "Xəta"), String(sum("errored"))], [L("Live events", "Canlı hadisələr"), String(feed.length)]] } },
    { label: L("Report ingested", "Hesabat qəbul edildi"), info: { title: L("Report ingested", "Hesabat qəbul edildi"), rows: [[L("Status", "Status"), scan.status], [L("Message", "Mesaj"), fmt(scan.message)]], note: L("Core validates each report against the assigned ruleset before storing it.", "Core hər hesabatı saxlamazdan əvvəl təyin olunmuş ruleset ilə yoxlayır.") } },
    { label: L("Score", "Skor"), detail: avg != null ? `${avg}%` : undefined, info: { title: L("Score", "Skor"), rows: scan.hosts.map((h) => [h.asset_name || h.host, h.score == null ? "-" : `${h.score}% (${L("weighted", "çəkili")} ${fmt(h.weighted_score)})`] as [string, string]) } },
  ];
  // Report and Score only light up once the scan is complete.
  const cur = end === "ok" ? steps.length : Math.min(current, 2);
  const checkInfo = (c: LiveCheck): Detail => ({ title: `${c.controlId}`, rows: [[L("Title", "Başlıq"), c.title], [L("Host", "Host"), c.hostName], [L("Status", "Status"), c.status], [L("Expected", "Gözlənilən"), c.expected], [L("Actual", "Faktiki"), fmt(c.actual)], [L("Duration", "Müddət"), `${c.durationMs} ms`]] });
  const lines: Line[] = feed.slice(-40).reverse().map((c) => ({
    key: c.key, text: `${c.hostName} · ${c.controlId} · ${c.status}`, tone: c.status === "pass" ? "ok" : c.status === "fail" ? "bad" : c.status === "error" ? "warn" : undefined,
    info: checkInfo(c),
  }));
  const calls: Call[] = feed.slice(-12).reverse().map((c) => ({ key: c.key, name: c.controlId, arg: c.hostName, status: c.status === "pass" ? "done" : c.status === "fail" || c.status === "error" ? "error" : "idle", info: checkInfo(c) }));
  const headline: Call = { key: "scan", name: "scan", arg: scan.profile_name, status: scan.status === "queued" ? "idle" : running ? "running" : end === "ok" ? "done" : "error", info: steps[0].info };
  const chips: Chip[] = scan.hosts.map((h) => ({
    key: String(h.id), label: h.asset_name || h.host, ok: h.passed, bad: h.failed, warn: h.errored,
    info: { title: h.asset_name || h.host, rows: [["Host", h.host], ["OS", fmt(h.os_detected)], [L("Status", "Status"), h.status], [L("Passed", "Keçdi"), String(h.passed)], [L("Failed", "Uğursuz"), String(h.failed)], [L("Errors", "Xəta"), String(h.errored)], [L("Not applicable", "Aid deyil"), String(h.not_applicable)], [L("Score", "Skor"), h.score == null ? "-" : `${h.score}%`], [L("Recent checks", "Son yoxlamalar"), feed.filter((c) => c.hostName === (h.asset_name || h.host) || c.hostId === h.id).slice(-5).map((c) => `${c.controlId} ${c.status}`).join(", ")]] },
  }));
  const stats: Stat[] = [
    { label: L("Passed", "Keçdi"), value: sum("passed"), tone: "ok" },
    { label: L("Failed", "Uğursuz"), value: sum("failed"), tone: sum("failed") ? "bad" : "plain" },
    { label: L("Errors", "Xəta"), value: sum("errored"), tone: sum("errored") ? "warn" : "plain" },
    { label: L("Checks done", "Yoxlama"), value: `${scan.done_checks}/${scan.total_checks}`, tone: "plain" },
  ];
  return <LiveFlow stats={stats} progress={pct} title={L("Live scan", "Canlı skan")} summary={`${scan.done_checks}/${scan.total_checks} · ${scan.status}`} steps={steps} current={cur} end={end} lines={lines} chips={chips} calls={calls} callsTitle={L("Live checks", "Canlı yoxlamalar")} headline={headline} live={scan.status === "queued" || running} />;
}

/** Hardening run: plan, queued, applying changes, finished (or rolled back). */
const changeStatus = (s: string): CallChipStatus => (s === "applied" || s === "completed" || s === "rolled_back" ? "done" : s === "failed" || s === "error" ? "error" : s === "running" || s === "applying" ? "running" : "idle");

export function HardeningFlow({ run, log }: { run: RunSummary & { changes?: Change[] }; log: LogLine[] }) {
  const { lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const active = run.status === "queued" || run.status === "running";
  const rolled = run.status === "rolled_back";
  const done = Math.min(run.done_changes, run.total_changes);
  const current = run.status === "queued" ? 1 : 2;
  const end = run.status === "completed" || rolled ? "ok" : run.status === "failed" ? "fail" : run.status === "cancelled" ? "stop" : null;
  const steps: Step[] = [
    { label: L("Plan approved", "Plan təsdiqləndi"), info: { title: L("Plan approved", "Plan təsdiqləndi"), rows: [[L("Run", "İcra"), run.name], ["Benchmark", run.benchmark_id], [L("Hosts", "Hostlar"), String(run.host_count)], [L("Risky confirmed", "Riskli təsdiqləndi"), run.confirm_risky ? L("yes", "bəli") : L("no", "xeyr")], [L("Created by", "Yaradan"), run.created_by], [L("Created", "Yaradılıb"), run.created_at]] } },
    { label: L("Queued for agents", "Agentlərə göndərildi"), info: { title: L("Queued for agents", "Agentlərə göndərildi"), rows: [[L("Status", "Status"), run.status], [L("Started", "Başladı"), fmt(run.started_at)]], note: L("Agents pick typed tasks up on their next heartbeat; remediation must be enabled on the agent.", "Agentlər tipli tapşırıqları növbəti heartbeat-də götürür; agentdə remediation aktiv olmalıdır.") } },
    { label: L("Applying changes", "Dəyişikliklər tətbiq olunur"), detail: `${done}/${run.total_changes}`, info: { title: L("Applying changes", "Dəyişikliklər tətbiq olunur"), rows: [[L("Progress", "Gediş"), `${done} / ${run.total_changes}`], [L("Applied", "Tətbiq olunub"), String(run.applied_count)], [L("Message", "Mesaj"), fmt(run.message)]] } },
    { label: rolled ? L("Rolled back", "Geri qaytarıldı") : L("Finished", "Bitdi"), info: { title: rolled ? L("Rolled back", "Geri qaytarıldı") : L("Finished", "Bitdi"), rows: [[L("Status", "Status"), run.status], [L("Finished", "Bitdi"), fmt(run.finished_at)], [L("Message", "Mesaj"), fmt(run.message)]] } },
  ];
  const cur = end === "ok" ? steps.length : current;
  const lines: Line[] = log.slice(-40).reverse().map((l) => ({
    key: l.key, text: l.text, tone: /fail|error/i.test(l.text) ? "bad" : /rollback/i.test(l.text) ? "warn" : undefined,
    info: { title: L("Event", "Hadisə"), rows: [[L("Log line", "Log sətri"), l.text]] },
  }));
  const calls: Call[] = (run.changes ?? []).slice(0, 30).map((c) => ({
    key: String(c.id), name: c.control_id, arg: c.asset_name, status: changeStatus(c.status),
    info: { title: c.control_id, rows: [[L("Host", "Host"), c.host], [L("Severity", "Ciddilik"), c.severity], [L("Status", "Status"), c.status], [L("Before", "Əvvəl"), `${fmt(c.before_status)} ${fmt(c.before_value)}`], [L("After", "Sonra"), `${fmt(c.after_status)} ${fmt(c.after_value)}`], [L("Risky", "Riskli"), c.risky ? L("yes", "bəli") : L("no", "xeyr")], [L("Message", "Mesaj"), fmt(c.message)], [L("Output", "Çıxış"), fmt(c.remediation_output).slice(0, 300)]] },
  }));
  const headline: Call = { key: "harden", name: "harden", arg: run.name, status: run.status === "queued" ? "idle" : run.status === "running" ? "running" : end === "ok" ? "done" : "error", info: steps[0].info };
  const failedN = (run.changes ?? []).filter((c) => c.status === "failed" || c.status === "error").length;
  const stats: Stat[] = [
    { label: L("Applied", "Tətbiq olunub"), value: run.applied_count, tone: "ok" },
    { label: L("Failed", "Uğursuz"), value: failedN, tone: failedN ? "bad" : "plain" },
    { label: L("Remaining", "Qalır"), value: Math.max(0, run.total_changes - done), tone: run.total_changes - done > 0 ? "warn" : "plain" },
    { label: L("Hosts", "Hostlar"), value: run.host_count, tone: "plain" },
  ];
  return <LiveFlow stats={stats} progress={run.total_changes ? Math.round((done / run.total_changes) * 100) : 0} title={L("Live hardening", "Canlı sərtləşdirmə")} calls={calls} callsTitle={L("Changes", "Dəyişikliklər")} headline={headline} summary={`${done}/${run.total_changes} · ${run.status}`} steps={steps} current={cur} end={end} lines={lines} live={active} />;
}
