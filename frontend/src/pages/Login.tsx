import { FormEvent, useState } from "react";
import { useAuth } from "../auth";
import { ApiError } from "../api";
import { useI18n } from "../i18n";

export default function Login() {
  const { login } = useAuth();
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(username, password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError(t("login.tooMany"));
      else if (err instanceof ApiError && err.status === 401) setError(t("login.wrong"));
      else setError(t("login.unreachable"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-8">
        <div>
          <h1 className="text-2xl font-bold text-cyan-400">Wearden</h1>
          <p className="mt-1 text-sm text-slate-400">{t("login.tagline")}</p>
        </div>

        <label className="block text-sm">
          <span className="text-slate-300">{t("login.username")}</span>
          <input
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-300">{t("login.password")}</span>
          <input
            type="password"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && (
          <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-cyan-600 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {pending ? t("login.signingIn") : t("login.signIn")}
        </button>
      </form>
    </div>
  );
}
