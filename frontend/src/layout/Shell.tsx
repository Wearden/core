import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

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

const THEME_KEY = "wearden.theme";

function readTheme(): "dark" | "light" {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark"; // storage can be unavailable; the app still renders
  }
}

export function applyStoredTheme() {
  document.documentElement.dataset.theme = readTheme();
}

function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-800 text-slate-300 hover:bg-slate-900"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
    </button>
  );
}

export default function Shell() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-sm font-bold text-slate-950">W</span>
          <span className="text-base font-semibold tracking-tight text-slate-50">Wearden</span>
        </div>
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
                      `block rounded-md px-3 py-1.5 text-sm transition-colors ${
                        isActive ? "bg-slate-800 font-medium text-slate-50" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                      }`
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
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-6 py-3 backdrop-blur">
          <span className="text-sm text-slate-500">{t("shell.tagline")}</span>
          <div className="flex items-center gap-2 text-sm">
            <div className="flex overflow-hidden rounded-md border border-slate-800" role="group" aria-label="language">
              {(["en", "az"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={`px-2.5 py-1 text-xs ${lang === l ? "bg-slate-100 text-slate-950" : "text-slate-400 hover:bg-slate-900"}`}
                >
                  {l === "en" ? "EN" : "AZ"}
                </button>
              ))}
            </div>
            <ThemeToggle />
            <button onClick={logout} className="rounded-md border border-slate-800 px-3 py-1 text-slate-300 hover:bg-slate-900">
              {t("common.logout")}
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
