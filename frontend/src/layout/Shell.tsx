import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

const NAV = [
  { to: "/", key: "nav.dashboard" },
  { to: "/assets", key: "nav.assets" },
  { to: "/scans", key: "nav.scans" },
  { to: "/hardening", key: "nav.hardening" },
  { to: "/rollback", key: "nav.rollback" },
  { to: "/reports", key: "nav.reports" },
  { to: "/attack", key: "nav.attack" },
  { to: "/benchmarks", key: "nav.benchmarks" },
  { to: "/sessions", key: "nav.sessions" },
  { to: "/audit", key: "nav.audit" },
  { to: "/settings", key: "nav.settings" },
];

export default function Shell() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <div className="px-5 py-5 text-xl font-bold tracking-tight text-cyan-400">Wearden</div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${
                  isActive ? "bg-slate-800 text-cyan-300" : "text-slate-300 hover:bg-slate-800/60"
                }`
              }
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-6 py-3">
          <span className="text-sm text-slate-400">{t("shell.tagline")}</span>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex overflow-hidden rounded-md border border-slate-700" role="group" aria-label="language">
              {(["en", "az"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={`px-2 py-1 text-xs ${lang === l ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}
                >
                  {l === "en" ? "EN" : "AZ"}
                </button>
              ))}
            </div>
            <span className="text-slate-300">
              {user?.username} <span className="text-slate-500">({user?.role})</span>
            </span>
            <button
              onClick={logout}
              className="rounded-md border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
            >
              {t("common.logout")}
            </button>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
