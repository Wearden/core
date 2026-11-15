import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

export default function ChangePassword() {
  const { user, reloadUser } = useAuth();
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (user && !user.must_change_password && !done) return <Navigate to="/" replace />;
  if (done) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 12) return setError(t("pw.tooShort"));
    if (next !== confirm) return setError(t("pw.mismatch"));
    try {
      await api.changePassword(current, next);
      await reloadUser();
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("pw.failed"));
    }
  };

  const field = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-8">
        <div>
          <h1 className="text-xl font-bold text-amber-300">{t("pw.title")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("pw.intro")}</p>
        </div>
        <label className="block text-sm">
          <span className="text-slate-300">{t("pw.current")}</span>
          <input type="password" className={field} value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">{t("pw.new")}</span>
          <input type="password" className={field} value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">{t("pw.confirm")}</span>
          <input type="password" className={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        <button type="submit" className="w-full rounded-md bg-cyan-600 py-2 font-medium text-white hover:bg-cyan-500">
          {t("pw.save")}
        </button>
      </form>
    </div>
  );
}
