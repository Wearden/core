import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { request } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { applyAppearance, getThemePref, setThemePref, ThemePref } from "../theme";
import CommandPalette, { PaletteItem } from "../components/CommandPalette";

const GROUPS = [
  { label: "Overview", items: [{ to: "/", key: "nav.dashboard" }, { to: "/assets", key: "nav.assets" }] },
  {
    label: "Security",
    items: [
      { to: "/scans", key: "nav.scans" },
      { to: "/hardening", key: "nav.hardening" },
      { to: "/rollback", key: "nav.rollback" },
      { to: "/attack", key: "nav.attack" },
      { to: "/benchmarks", key: "nav.benchmarks" },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/reports", key: "nav.reports" },
      { to: "/sessions", key: "nav.sessions" },
      { to: "/audit", key: "nav.audit" },
      { to: "/settings", key: "nav.settings" },
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

export default function Shell() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const az = lang === "az";
  const location = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  useOutside(menuRef, () => setMenu(false), menu);
  useOutside(bellRef, () => setBell(false), bell);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950">
        <Link to="/" className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-sm font-bold text-slate-950">W</span>
          <span className="text-base font-semibold tracking-tight text-slate-50">Wearden</span>
        </Link>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-1.5 text-sm transition-colors ${isActive ? "bg-slate-800 font-medium text-slate-50" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"}`
                    }
                  >
                    {t(item.key)}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-5 py-3 text-xs text-slate-500">
          <div className="truncate text-slate-300">{user?.username}</div>
          <div>{user?.role}</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-slate-800 bg-slate-950/90 px-6 py-2.5 backdrop-blur">
          <nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
            {crumbs.map((c, i) => (
              <span key={c.to} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden className="text-slate-700">/</span>}
                {i < crumbs.length - 1 ? <Link to={c.to} className="text-slate-500 hover:text-slate-200">{c.label}</Link> : <span className="truncate text-slate-100">{c.label}</span>}
              </span>
            ))}
          </nav>

          <button onClick={() => setPalette(true)} className="ml-auto hidden w-72 items-center gap-2 rounded-md border border-slate-800 px-3 py-1.5 text-left text-sm text-slate-500 hover:border-slate-600 md:flex" aria-label="Search">
            <Icon d="M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
            <span className="flex-1">{az ? "Axtar..." : "Search..."}</span>
            <kbd className="rounded border border-slate-700 px-1.5 text-[10px] text-slate-500">Ctrl K</kbd>
          </button>

          <div className="flex items-center gap-2">
            <div className="relative" ref={bellRef}>
              <button onClick={() => setBell(!bell)} aria-label="Alerts" aria-expanded={bell} className="relative flex h-8 w-8 items-center justify-center rounded-md border border-slate-800 text-slate-300 hover:bg-slate-900">
                <Icon d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
                {alerts.length > 0 && <span aria-hidden className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-400 px-1 text-[10px] font-semibold text-slate-950">{alerts.length}</span>}
              </button>
              {bell && (
                <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
                  <div className="border-b border-slate-800 px-4 py-2.5 text-sm font-medium text-slate-100">{az ? "Xəbərdarlıqlar" : "Alerts"}</div>
                  {alerts.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">{az ? "Aktiv xəbərdarlıq yoxdur." : "No active alerts."}</p> : (
                    <ul className="max-h-72 divide-y divide-slate-800 overflow-y-auto">
                      {alerts.slice(0, 8).map((a) => (
                        <li key={a.id} className="px-4 py-2.5 text-sm">
                          <div className="text-slate-200">{a.message}</div>
                          <div className="text-xs text-slate-500">{new Date(a.detected_at).toLocaleString()} · {a.severity}</div>
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
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-950">{user?.username?.[0]?.toUpperCase() ?? "?"}</span>
                <span className="hidden max-w-28 truncate sm:inline">{user?.username}</span>
              </button>
              {menu && (
                <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
                  <div className="border-b border-slate-800 px-4 py-3">
                    <div className="truncate text-sm font-medium text-slate-50">{user?.username}</div>
                    <div className="text-xs text-slate-500">{user?.role}</div>
                  </div>
                  <div className="p-1 text-sm">
                    <Link to="/settings?section=profile" onClick={() => setMenu(false)} className="block rounded-md px-3 py-2 text-slate-200 hover:bg-slate-800">{az ? "Profil" : "Profile"}</Link>
                    <Link to="/settings" onClick={() => setMenu(false)} className="block rounded-md px-3 py-2 text-slate-200 hover:bg-slate-800">{t("nav.settings")}</Link>
                  </div>
                  <div className="border-t border-slate-800 px-4 py-3">
                    <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">{az ? "Tema" : "Theme"}</div>
                    <div className="flex overflow-hidden rounded-md border border-slate-700" role="group" aria-label="theme">
                      {(["dark", "light", "system"] as const).map((v) => (
                        <button key={v} onClick={() => chooseTheme(v)} aria-pressed={theme === v} className={`flex-1 px-2 py-1 text-xs ${theme === v ? "bg-slate-100 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}>
                          {v === "dark" ? (az ? "Qara" : "Black") : v === "light" ? (az ? "Ağ" : "White") : az ? "Sistem" : "System"}
                        </button>
                      ))}
                    </div>
                    <div className="mb-1.5 mt-3 text-[11px] uppercase tracking-wide text-slate-500">{az ? "Dil" : "Language"}</div>
                    <div className="flex overflow-hidden rounded-md border border-slate-700" role="group" aria-label="language">
                      {(["en", "az"] as const).map((l) => (
                        <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={`flex-1 px-2 py-1 text-xs ${lang === l ? "bg-slate-100 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}>{l === "en" ? "English" : "Azərbaycanca"}</button>
                      ))}
                    </div>
                  </div>
                  <button onClick={logout} className="w-full border-t border-slate-800 px-4 py-2.5 text-left text-sm text-red-300 hover:bg-slate-800">{t("common.logout")}</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} pages={pages} />
    </div>
  );
}
