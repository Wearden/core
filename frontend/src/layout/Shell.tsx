import { useEffect, useMemo, useRef, useState } from "react";
import { Segment } from "../components/ui";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, request } from "../api";
import { assetsApi } from "../assetsApi";
import { scansApi } from "../scansApi";
import { isPam } from "../types";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { applyAppearance, getMotion, getThemePref, Motion, setMotion, setThemePref, ThemePref } from "../theme";
import Logo from "../components/Logo";
import { MetalMark, MetalWord } from "../components/MetalBrand";
import UserAvatar, { DisplayName, useProfile } from "../components/UserAvatar";
import CommandPalette, { PaletteItem } from "../components/CommandPalette";
import ChatWidget from "../components/ChatWidget";
import { dateTime } from "../time";

// Two-key "go to" shortcuts, in the style of common admin tools: press g, then the letter.
const GO_KEYS: Record<string, string> = { d: "/", a: "/assets", s: "/scans", h: "/hardening", r: "/reports", u: "/audit", b: "/benchmarks", t: "/settings" };

const ICONS: Record<string, string> = {
  "/": "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  "/assets": "M3 4h18v12H3zM8 20h8M12 16v4",
  "/scans": "M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z",
  "/hardening": "M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6zM9 12l2 2 4-4",
  "/rollback": "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  "/attack": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 1v3M12 20v3M1 12h3M20 12h3",
  "/benchmarks": "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  "/reports": "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h8",
  "/pam/sessions": "M4 17l6-6-6-6M12 19h8",
  "/audit": "M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
  "/settings": "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  "/pam/assets": "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5zM12 15v2",
  "/pam/scans": "M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM8 10.5h5",
  "/pam/hardening": "M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6zM12 9v4M12 16h.01",
  "/pam/rollback": "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3M14 15h.01",
};

const GROUPS = [
  { label: "Overview", items: [{ to: "/", key: "nav.dashboard", hint: "g d" }, { to: "/assets", key: "nav.assets", hint: "g a" }] },
  {
    label: "Security",
    items: [
      { to: "/scans", key: "nav.scans", hint: "g s" },
      { to: "/hardening", key: "nav.hardening", hint: "g h" },
      { to: "/rollback", key: "nav.rollback", hint: "" },
      { to: "/attack", key: "nav.attack", hint: "" },
      { to: "/benchmarks", key: "nav.benchmarks", hint: "g b" },
    ],
  },
  {
    // Agentless management over SSH or WinRM, kept apart from the agent pages above.
    label: "Remote Control",
    items: [
      { to: "/pam/assets", key: "nav.pamAssets", hint: "" },
      { to: "/pam/scans", key: "nav.pamScans", hint: "" },
      { to: "/pam/hardening", key: "nav.pamHardening", hint: "" },
      { to: "/pam/rollback", key: "nav.pamRollback", hint: "" },
      { to: "/pam/sessions", key: "nav.sessions", hint: "" },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/reports", key: "nav.reports", hint: "g r" },
      { to: "/audit", key: "nav.audit", hint: "g u" },
      { to: "/settings", key: "nav.settings", hint: "g t" },
    ],
  },
];

export function applyStoredTheme() {
  applyAppearance();
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function useOutside(ref: React.RefObject<HTMLElement>, close: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [ref, close, active]);
}

/** Navigation: icons, live badges, a collapsible icon rail (remembered) and a status and account footer. Used on desktop and in the phone drawer. */
function Sidebar({ collapsed, onToggle, mobile }: { collapsed: boolean; onToggle?: () => void; mobile?: boolean }) {
  const { user, logout } = useAuth();
  const { t, lang } = useI18n();
  const az = lang === "az";
  const rail = collapsed && !mobile;
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const ready = useQuery({ queryKey: ["ready"], queryFn: api.ready, refetchInterval: 10_000 });
  const scans = useQuery({ queryKey: ["scans"], queryFn: scansApi.list, refetchInterval: 30_000 });
  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list, refetchInterval: 30_000 });
  // Agent and PAM work are counted on their own menu items.
  const isActive = (x: { status: string }) => x.status === "queued" || x.status === "running" || x.status === "cancel_requested";
  const activeScans = (scans.data ?? []).filter((x) => x.mode !== "pam" && isActive(x)).length;
  const activePamScans = (scans.data ?? []).filter((x) => x.mode === "pam" && isActive(x)).length;
  const offline = (assets.data ?? []).filter((x) => !isPam(x) && x.status === "offline").length;
  const offlinePam = (assets.data ?? []).filter((x) => isPam(x) && x.status === "offline").length;
  const badge: Record<string, { n: number; tone: string; title: string }> = {
    "/scans": { n: activeScans, tone: "bg-slate-100 text-slate-950", title: az ? "aktiv yoxlama" : "active scans" },
    "/assets": { n: offline, tone: "bg-red-400 text-slate-950", title: az ? "oflayn host" : "offline hosts" },
    "/pam/scans": { n: activePamScans, tone: "bg-slate-100 text-slate-950", title: az ? "aktiv PAM skanı" : "active PAM scans" },
    "/pam/assets": { n: offlinePam, tone: "bg-red-400 text-slate-950", title: az ? "oflayn PAM hostu" : "offline PAM hosts" },
  };
  const apiOk = health.data?.status === "ok" && ready.data?.database === "ok";
  const profile = useProfile();
  const { pathname } = useLocation();
  const [closed, setClosed] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("wearden.nav.closed") || "[]");
    } catch {
      return [];
    }
  });
  const toggleGroup = (gi: number) =>
    setClosed((c) => {
      const next = c.includes(gi) ? c.filter((x) => x !== gi) : [...c, gi];
      try { localStorage.setItem("wearden.nav.closed", JSON.stringify(next)); } catch { /* convenience only */ }
      return next;
    });
  const shut = (gi: number, group: (typeof GROUPS)[number]) => closed.includes(gi) && !group.items.some((i) => (i.to === "/" ? pathname === "/" : pathname.startsWith(i.to)));
  const statusText = health.isLoading ? "..." : apiOk ? (az ? "Sistem işləyir" : "All systems normal") : az ? "Problem var" : "Service issue";

  return (
    <>
      <div className={`flex items-center ${rail ? "justify-center px-2" : "justify-between px-4"} py-4`}>
        <Link to="/" className="flex items-center gap-2.5" aria-label="Wearden">
          <MetalMark size={34} />
          {!rail && <span className="leading-tight"><MetalWord text="Wearden" /><span className="block text-[11px] text-slate-500">{az ? "Təhlükəsizlik sərtləşdirmə" : "Security hardening"}</span></span>}
        </Link>
        {!mobile && !rail && onToggle && (
          <button onClick={onToggle} aria-label={az ? "Paneli yığ" : "Collapse sidebar"} title={(az ? "Paneli yığ" : "Collapse sidebar") + "  ["} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-900 hover:text-slate-100">
            <Icon d="M15 6l-6 6 6 6" />
          </button>
        )}
      </div>
      {rail && onToggle && (
        <button onClick={onToggle} aria-label={az ? "Paneli aç" : "Expand sidebar"} title={(az ? "Paneli aç" : "Expand sidebar") + "  ["} className="mx-auto mb-2 flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-900 hover:text-slate-100">
          <Icon d="M9 6l6 6-6 6" />
        </button>
      )}

      <nav className={`flex-1 space-y-4 overflow-y-auto pb-3 ${rail ? "px-2" : "px-3"}`} aria-label="Main">
        {GROUPS.map((group, gi) => (
          <div key={group.label}>
            {rail ? (gi > 0 && <div className="mx-2 mb-3 border-t border-slate-800" />) : (
              <button type="button" onClick={() => toggleGroup(gi)} aria-expanded={!shut(gi, group)} className="flex w-full items-center justify-between rounded px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300">
                {group.label}
                <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-3 w-3 transition-transform ${shut(gi, group) ? "-rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            )}
            <div className={`space-y-0.5 ${!rail && shut(gi, group) ? "hidden" : ""}`}>
              {group.items.map((item) => {
                const b = badge[item.to];
                const label = t(item.key);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    title={rail ? `${label}${item.hint ? "  (" + item.hint + ")" : ""}` : undefined}
                    aria-label={rail ? label : undefined}
                    className={({ isActive }) =>
                      `group relative flex h-9 items-center rounded-md text-sm transition-colors ${rail ? "justify-center" : "gap-3 px-3"} ${isActive ? "bg-gradient-to-r from-slate-800 to-slate-800/30 font-medium text-slate-50 shadow-sm" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"}`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span aria-hidden className="absolute -left-3 top-2 h-5 w-[3px] rounded-r bg-slate-100" style={rail ? { left: "-0.5rem" } : undefined} />}
                        <span className="relative flex shrink-0"><Icon d={ICONS[item.to]} />{rail && b && b.n > 0 && <span aria-hidden className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${b.tone}`} />}</span>
                        {!rail && <span className="flex-1 truncate">{label}</span>}
                        {!rail && b && b.n > 0 && <span title={b.title} className={`rounded-full px-1.5 text-[11px] font-semibold leading-5 ${b.tone}`}>{b.n}</span>}
                        {!rail && !(b && b.n > 0) && item.hint && <kbd className="hidden rounded border border-slate-800 px-1 text-[10px] text-slate-600 group-hover:inline">{item.hint}</kbd>}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <div className={`mb-3 flex items-center gap-2 text-xs text-slate-400 ${rail ? "justify-center" : "rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2"}`} title={statusText}>
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${health.isLoading ? "bg-slate-500" : apiOk ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.15)]" : "bg-red-400 shadow-[0_0_0_3px_rgba(248,113,113,0.15)]"}`} />
          {!rail && <span className="truncate">{statusText}</span>}
        </div>
        <div className={`flex items-center ${rail ? "flex-col gap-2" : "gap-2.5"}`}>
          <Link to="/settings?section=profile" title={rail ? `${user?.username} (${user?.role})` : undefined} className={`flex min-w-0 items-center gap-2.5 rounded-lg ${rail ? "" : "flex-1 border border-transparent p-1.5 transition-colors hover:border-slate-800 hover:bg-slate-900"}`}>
            <UserAvatar size={32} />
            {!rail && (
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm text-slate-100"><DisplayName /></span>
                <span className="block truncate text-[11px] text-slate-500">{profile.data?.job_title || <span className="capitalize">{user?.role}</span>}</span>
              </span>
            )}
          </Link>
          <button onClick={logout} aria-label={t("common.logout")} title={t("common.logout")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-900 hover:text-red-300">
            <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </button>
        </div>
      </div>
    </>
  );
}

export default function Shell() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const az = lang === "az";
  const location = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("wearden.sidebar") === "collapsed"; } catch { return false; }
  });
  const toggleSidebar = () =>
    setCollapsed((v) => {
      try { localStorage.setItem("wearden.sidebar", v ? "open" : "collapsed"); } catch { /* convenience only */ }
      return !v;
    });
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [motion, setMotionPref] = useState<Motion>(getMotion);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  useOutside(menuRef, () => setMenu(false), menu);
  useOutside(bellRef, () => setBell(false), bell);

  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHelp(false);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      if (e.ctrlKey || e.metaKey || e.altKey || target?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "?") {
        setHelp((v) => !v);
      } else if (e.key === "/") {
        e.preventDefault();
        setPalette(true);
      } else if (e.key === "[") {
        setCollapsed((v) => {
          try { localStorage.setItem("wearden.sidebar", v ? "open" : "collapsed"); } catch { /* convenience only */ }
          return !v;
        });
      } else if (e.key === "g") {
        armed = Date.now();
      } else if (armed && Date.now() - armed < 1500 && GO_KEYS[e.key]) {
        armed = 0;
        navigate(GO_KEYS[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  // Alerts: active drift events and failed hardening runs are the two things that need attention.
  const drift = useQuery({ queryKey: ["drift"], queryFn: () => request<{ id: number; message: string; severity: string; detected_at: string }[]>("/drift?active_only=true"), refetchInterval: 30_000 });
  const alerts = drift.data ?? [];

  const pages = useMemo<PaletteItem[]>(() => GROUPS.flatMap((g) => g.items.map((i) => ({ id: i.to, label: t(i.key), hint: g.label, to: i.to }))), [t]);

  const crumbs = useMemo(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    const base = GROUPS.flatMap((g) => g.items).find((i) => i.to === `/${parts[0] ?? ""}`) ?? GROUPS[0].items[0];
    const out = [{ label: t(base.key), to: base.to }];
    if (parts.length > 1) out.push({ label: parts[0] === "hosts" ? (az ? "Host" : "Host") : az ? "Detal" : "Detail", to: location.pathname });
    return out;
  }, [location.pathname, t, az]);

  const chooseTheme = (v: ThemePref) => {
    setTheme(v);
    setThemePref(v);
  };

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-slate-100 focus:px-3 focus:py-2 focus:text-sm focus:text-slate-950">{az ? "Məzmuna keç" : "Skip to content"}</a>
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-800 bg-slate-950 transition-[width] duration-200 lg:flex ${collapsed ? "w-[4.25rem]" : "w-60"}`}>
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div className="absolute inset-0 bg-black/60" aria-hidden />
          <aside className="relative flex h-full w-[min(18rem,85vw)] flex-col border-r border-slate-800 bg-slate-950 shadow-2xl" onClick={(e) => (e.target as HTMLElement).closest("a") && setDrawer(false)}>
            <Sidebar collapsed={false} mobile />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-800 bg-slate-950/90 px-4 py-2.5 backdrop-blur md:gap-4 md:px-6">
          <button onClick={() => setDrawer(true)} aria-label="Open navigation" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-800 text-slate-300 hover:bg-slate-900 lg:hidden">
            <Icon d="M4 6h16M4 12h16M4 18h16" />
          </button>
          <nav aria-label="breadcrumb" className="flex min-w-0 flex-1 items-center gap-2 text-sm md:flex-none">
            {crumbs.map((c, i) => (
              <span key={c.to} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden className="text-slate-700">/</span>}
                {i < crumbs.length - 1 ? <Link to={c.to} className="text-slate-500 hover:text-slate-200">{c.label}</Link> : <span className="truncate text-slate-100">{c.label}</span>}
              </span>
            ))}
          </nav>

          <button onClick={() => setPalette(true)} className="ml-auto flex h-8 w-8 items-center justify-center rounded-md border border-slate-800 text-slate-400 hover:border-slate-600 md:h-auto md:w-72 md:justify-start md:gap-2 md:px-3 md:py-1.5 md:text-left md:text-sm md:text-slate-500" aria-label="Search">
            <Icon d="M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
            <span className="hidden flex-1 md:block">{az ? "Axtar..." : "Search..."}</span>
            <kbd className="hidden rounded border border-slate-700 px-1.5 text-[10px] text-slate-500 md:block">Ctrl K</kbd>
          </button>

          <div className="flex items-center gap-2">
            <div className="relative" ref={bellRef}>
              <button onClick={() => setBell(!bell)} aria-label="Alerts" aria-expanded={bell} className="relative flex h-8 w-8 items-center justify-center rounded-md border border-slate-800 text-slate-300 hover:bg-slate-900">
                <Icon d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
                {alerts.length > 0 && <span aria-hidden className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-400 px-1 text-[10px] font-semibold text-slate-950">{alerts.length}</span>}
              </button>
              {bell && (
                <div className="absolute right-0 mt-2 w-[min(20rem,92vw)] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
                  <div className="border-b border-slate-800 px-4 py-2.5 text-sm font-medium text-slate-100">{az ? "Xəbərdarlıqlar" : "Alerts"}</div>
                  {alerts.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">{az ? "Aktiv xəbərdarlıq yoxdur." : "No active alerts."}</p> : (
                    <ul className="max-h-72 divide-y divide-slate-800 overflow-y-auto">
                      {alerts.slice(0, 8).map((a) => (
                        <li key={a.id} className="px-4 py-2.5 text-sm">
                          <div className="text-slate-200">{a.message}</div>
                          <div className="text-xs text-slate-500">{dateTime(a.detected_at)} · {a.severity}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button onClick={() => { setBell(false); navigate("/"); }} className="w-full border-t border-slate-800 py-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100">{az ? "İdarə panelinə keç" : "Open dashboard"}</button>
                </div>
              )}
            </div>

            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenu(!menu)} aria-label="Account menu" aria-expanded={menu} className="flex items-center gap-2 rounded-md border border-slate-800 py-1 pl-1 pr-2.5 text-sm text-slate-200 hover:bg-slate-900">
                <UserAvatar size={24} />
                <span className="hidden max-w-28 truncate sm:inline"><DisplayName /></span>
              </button>
              {menu && (
                <div className="absolute right-0 mt-2 w-[min(16rem,92vw)] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
                  <div className="border-b border-slate-800 px-4 py-3">
                    <div className="truncate text-sm font-medium text-slate-50"><DisplayName /></div>
                    <div className="text-xs text-slate-500">{user?.role}</div>
                  </div>
                  <div className="p-1 text-sm">
                    <Link to="/settings?section=profile" onClick={() => setMenu(false)} className="block rounded-md px-3 py-2 text-slate-200 hover:bg-slate-800">{az ? "Profil" : "Profile"}</Link>
                    <Link to="/settings" onClick={() => setMenu(false)} className="block rounded-md px-3 py-2 text-slate-200 hover:bg-slate-800">{t("nav.settings")}</Link>
                    <button onClick={() => { setMenu(false); setHelp(true); }} className="block w-full rounded-md px-3 py-2 text-left text-slate-200 hover:bg-slate-800">{az ? "Qısayollar" : "Keyboard shortcuts"}</button>
                  </div>
                  <div className="border-t border-slate-800 px-4 py-3">
                    <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">{az ? "Tema" : "Theme"}</div>
                    <Segment label="theme" equal value={theme} onChange={chooseTheme} options={[{ id: "dark", label: az ? "Qara" : "Black" }, { id: "light", label: az ? "Ağ" : "White" }, { id: "system", label: az ? "Sistem" : "System" }]} />
                    <div className="mb-1.5 mt-3 text-[11px] uppercase tracking-wide text-slate-500">{az ? "Animasiyalar" : "Animations"}</div>
                    <Segment label="animations" equal value={motion} onChange={(v) => { setMotionPref(v); setMotion(v); }} options={[{ id: "on", label: az ? "Açıq" : "On" }, { id: "system", label: az ? "Sistem" : "System" }, { id: "off", label: az ? "Bağlı" : "Off" }]} />
                    <div className="mb-1.5 mt-3 text-[11px] uppercase tracking-wide text-slate-500">{az ? "Dil" : "Language"}</div>
                    <Segment label="language" equal value={lang} onChange={setLang} options={[{ id: "en", label: "English" }, { id: "az", label: "Azərbaycanca" }]} />
                  </div>
                  <button onClick={logout} className="w-full border-t border-slate-800 px-4 py-2.5 text-left text-sm text-red-300 hover:bg-slate-800">{t("common.logout")}</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 p-4 outline-none md:p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} pages={pages} />
      <ChatWidget />
      {help && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.target === e.currentTarget && setHelp(false)}>
          <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-50">{az ? "Klaviatura qısayolları" : "Keyboard shortcuts"}</h2>
              <button onClick={() => setHelp(false)} aria-label="Close" className="text-slate-500 hover:text-slate-200">x</button>
            </div>
            <dl className="space-y-1.5 text-sm">
              {[
                ["Ctrl K  or  /", az ? "Axtarış və keçid" : "Search and jump"],
                ["?", az ? "Bu pəncərə" : "This window"],
                ["[", az ? "Yan paneli yığ / aç" : "Collapse or expand sidebar"],
                ["g d", t("nav.dashboard")], ["g a", t("nav.assets")], ["g s", t("nav.scans")], ["g h", t("nav.hardening")],
                ["g r", t("nav.reports")], ["g b", t("nav.benchmarks")], ["g u", t("nav.audit")], ["g t", t("nav.settings")],
                ["Esc", az ? "Pəncərəni bağla" : "Close a window"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-4 border-b border-slate-800/70 py-1.5 last:border-0">
                  <dt className="text-slate-300">{v}</dt>
                  <dd><kbd className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-xs text-slate-200">{k}</kbd></dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
