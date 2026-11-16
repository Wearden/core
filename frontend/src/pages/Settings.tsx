import { FormEvent, ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { agentsApi } from "../agentsApi";
import { aiAdminApi, SettingRow, settingsApi, UserRow, usersApi } from "../settingsApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { getDensity, getThemePref, setDensity, setThemePref, Density, ThemePref } from "../theme";
import { EmptyState, PageHeader, tableWrap, theadCls } from "../components/ui";

const field = "w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-slate-500";
const btn = "rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-40";
const btnPrimary = "rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium hover:bg-cyan-500 disabled:opacity-40";

type Section = "profile" | "appearance" | "ai" | "agents" | "users" | "about";

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div>
        <h2 className="text-sm font-medium text-slate-100">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function errText(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : "Request failed";
}

/** One stored setting: current source, an input, save and remove. Secret values are never shown again. */
function SettingField({ row, vaultReady, label, hint, type = "text", listId, extra }: { row: SettingRow | undefined; vaultReady: boolean; label: string; hint?: string; type?: string; listId?: string; extra?: ReactNode }) {
  const { lang } = useI18n();
  const az = lang === "az";
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const done = () => {
    setValue("");
    return qc.invalidateQueries({ queryKey: ["settings"] });
  };
  const save = useMutation({ mutationFn: () => settingsApi.set(row!.key, value.trim()), onSuccess: done });
  const clear = useMutation({ mutationFn: () => settingsApi.clear(row!.key), onSuccess: done });
  if (!row) return null;
  const err = (save.error ?? clear.error) as Error | null;
  const source = row.source === "database" ? (az ? "UI-dan təyin edilib" : "Set in UI") : row.source === "environment" ? (az ? "Mühitdən" : "From environment") : az ? "Təyin edilməyib" : "Not set";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-slate-200" htmlFor={`f-${row.key}`}>{label}</label>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${row.configured ? "border-slate-600 text-slate-300" : "border-slate-800 text-slate-500"}`}>{source}</span>
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {!row.secret && row.value && <p className="font-mono text-xs text-slate-400">{az ? "Cari" : "Current"}: {row.value}</p>}
      {row.secret && row.configured && <p className="text-xs text-slate-500">{az ? "Dəyər saxlanılıb. Dəyişmək üçün yenisini daxil edin." : "A value is stored. Enter a new one to replace it."}</p>}
      <div className="flex flex-wrap gap-2">
        <input id={`f-${row.key}`} className={`${field} flex-1`} type={type} list={listId} autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={az ? "Yeni dəyər" : "New value"} />
        <button className={btnPrimary} disabled={!vaultReady || !value.trim() || save.isPending} onClick={() => save.mutate()}>{az ? "Saxla" : "Save"}</button>
        {row.source === "database" && <button className={btn} disabled={clear.isPending} onClick={() => clear.mutate()}>{az ? "Sil" : "Remove"}</button>}
        {extra}
      </div>
      {err && <p className="text-xs text-red-300">{err.message}</p>}
    </div>
  );
}

function Profile() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const change = useMutation({
    mutationFn: () => api.changePassword(cur, next),
    onSuccess: () => { setCur(""); setNext(""); setAgain(""); setMsg({ ok: true, text: az ? "Parol dəyişdirildi. Digər sessiyalar bağlandı." : "Password changed. Other sessions were signed out." }); },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next.length < 12) return setMsg({ ok: false, text: az ? "Parol ən azı 12 simvol olmalıdır." : "The password must be at least 12 characters." });
    if (next !== again) return setMsg({ ok: false, text: az ? "Parollar uyğun gəlmir." : "The passwords do not match." });
    change.mutate();
  };
  return (
    <>
      <Card title={az ? "Hesab" : "Account"}>
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-xl font-semibold text-slate-950">{user?.username?.[0]?.toUpperCase() ?? "?"}</span>
          <div>
            <div className="text-base font-medium text-slate-50">{user?.username}</div>
            <div className="mt-1 inline-flex rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300">{user?.role}</div>
          </div>
        </div>
      </Card>
      <Card title={az ? "Parolu dəyiş" : "Change password"} hint={az ? "Ən azı 12 simvol. Digər sessiyalar bağlanacaq." : "At least 12 characters. Your other sessions will be signed out."}>
        <form onSubmit={submit} className="grid max-w-md gap-3">
          <input className={field} type="password" autoComplete="current-password" placeholder={az ? "Cari parol" : "Current password"} value={cur} onChange={(e) => setCur(e.target.value)} />
          <input className={field} type="password" autoComplete="new-password" placeholder={az ? "Yeni parol" : "New password"} value={next} onChange={(e) => setNext(e.target.value)} />
          <input className={field} type="password" autoComplete="new-password" placeholder={az ? "Yeni parolu təkrarla" : "Repeat new password"} value={again} onChange={(e) => setAgain(e.target.value)} />
          <div className="flex items-center gap-3">
            <button className={btnPrimary} disabled={!cur || !next || change.isPending}>{az ? "Parolu yenilə" : "Update password"}</button>
            {msg && <span className={`text-xs ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</span>}
          </div>
        </form>
      </Card>
    </>
  );
}

function Appearance() {
  const { lang, setLang } = useI18n();
  const az = lang === "az";
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [density, setDens] = useState<Density>(getDensity);
  const choice = <T extends string>(value: T, current: T, label: string, on: (v: T) => void) => (
    <button key={value} onClick={() => on(value)} aria-pressed={current === value} className={`rounded-md border px-4 py-2 text-sm ${current === value ? "border-slate-100 bg-slate-100 text-slate-950" : "border-slate-800 text-slate-300 hover:bg-slate-900"}`}>{label}</button>
  );
  return (
    <>
      <Card title={az ? "Tema" : "Theme"} hint={az ? "Qara, ağ və ya sistem ayarı." : "Black, white or follow the system setting."}>
        <div className="flex flex-wrap gap-2">
          {choice<ThemePref>("dark", theme, az ? "Qara" : "Black", (v) => { setTheme(v); setThemePref(v); })}
          {choice<ThemePref>("light", theme, az ? "Ağ" : "White", (v) => { setTheme(v); setThemePref(v); })}
          {choice<ThemePref>("system", theme, az ? "Sistem" : "System", (v) => { setTheme(v); setThemePref(v); })}
        </div>
      </Card>
      <Card title={az ? "Cədvəl sıxlığı" : "Table density"} hint={az ? "Sıx rejim bir ekrana daha çox sətir sığdırır." : "Compact fits more rows on screen."}>
        <div className="flex flex-wrap gap-2">
          {choice<Density>("comfortable", density, az ? "Rahat" : "Comfortable", (v) => { setDens(v); setDensity(v); })}
          {choice<Density>("compact", density, az ? "Sıx" : "Compact", (v) => { setDens(v); setDensity(v); })}
        </div>
      </Card>
      <Card title={az ? "Dil" : "Language"}>
        <div className="flex gap-2">
          {choice<"en" | "az">("en", lang, "English", setLang)}
          {choice<"en" | "az">("az", lang, "Azərbaycanca", setLang)}
        </div>
      </Card>
    </>
  );
}

function AiSettings({ rows, vaultReady }: { rows: SettingRow[]; vaultReady: boolean }) {
  const { lang } = useI18n();
  const az = lang === "az";
  const key = rows.find((r) => r.key === "anthropic_api_key");
  const model = rows.find((r) => r.key === "anthropic_model");
  const models = useMutation({ mutationFn: aiAdminApi.models });
  const test = useMutation({ mutationFn: aiAdminApi.test });
  const ready = !!key?.configured && !!model?.configured;
  return (
    <>
      <Card title={az ? "AI provayderi" : "AI provider"} hint={az ? "Scan nəticələrinin AI analizi və nəzarət izahları üçün. Açar vault ilə şifrələnir və bir daha göstərilmir." : "Used for AI scan analysis and control explanations. The key is encrypted with the vault and never shown again."}>
        <SettingField row={key} vaultReady={vaultReady} label={az ? "API açarı" : "API key"} type="password" />
        <datalist id="ai-models">{(models.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
        <SettingField
          row={model}
          vaultReady={vaultReady}
          label={az ? "Model" : "Model"}
          listId="ai-models"
          hint={az ? "İstənilən model identifikatorunu yaza bilərsiniz. Provayderdən siyahı yükləyib seçə də bilərsiniz." : "Type any model identifier you want, or load the list from the provider and pick one."}
          extra={<button className={btn} disabled={!key?.configured || models.isPending} onClick={() => models.mutate()}>{models.isPending ? "..." : az ? "Siyahını yüklə" : "Load models"}</button>}
        />
        {models.error && <p className="text-xs text-red-300">{errText(models.error)}</p>}
        {models.data && <p className="text-xs text-slate-500">{models.data.length} {az ? "model tapıldı, sahəyə yazanda təklif olunur." : "models found, suggested while you type."}</p>}
      </Card>
      <Card title={az ? "Bağlantını yoxla" : "Test the connection"} hint={az ? "Saxlanılmış açar və modellə provayderə çox kiçik sorğu göndərir." : "Sends one very small request with the stored key and model."}>
        <div className="flex flex-wrap items-center gap-3">
          <button className={btnPrimary} disabled={!ready || test.isPending} onClick={() => test.mutate()}>{test.isPending ? (az ? "Yoxlanır..." : "Testing...") : az ? "Yoxla" : "Test"}</button>
          {!ready && <span className="text-xs text-slate-500">{az ? "Əvvəlcə açarı və modeli saxlayın." : "Save the key and the model first."}</span>}
          {test.data && <span className={`text-xs ${test.data.ok ? "text-emerald-300" : "text-red-300"}`}>{test.data.message}</span>}
          {test.error && <span className="text-xs text-red-300">{errText(test.error)}</span>}
        </div>
      </Card>
    </>
  );
}

function AgentSettings({ rows, vaultReady }: { rows: SettingRow[]; vaultReady: boolean }) {
  const { lang } = useI18n();
  const az = lang === "az";
  const info = useQuery({ queryKey: ["install-info"], queryFn: agentsApi.installInfo });
  return (
    <>
      <Card title={az ? "Agent logları" : "Agent logs"} hint={az ? "Agentlərin göndərdiyi status loglarının saxlanma müddəti." : "How long operational logs sent by agents are kept."}>
        <SettingField row={rows.find((r) => r.key === "log_retention_days")} vaultReady={vaultReady} label={az ? "Saxlama müddəti (gün)" : "Retention (days)"} hint={az ? "1 ilə 365 arası. Boş buraxılsa 30 gün." : "1 to 365. Defaults to 30 days when unset."} />
      </Card>
      <Card title={az ? "Agent quraşdırma paketi" : "Agent install package"} hint={az ? "Core agent binary-sini və quraşdırma skriptini verir." : "Core serves the agent binary and the installer script."}>
        <div className="flex items-center gap-2 text-sm">
          <span aria-hidden className={`h-2 w-2 rounded-full ${info.data?.linux_available ? "bg-emerald-400" : "bg-amber-400"}`} />
          <span className="text-slate-200">{info.data?.linux_available ? (az ? "Linux paketi mövcuddur" : "Linux package is available") : az ? "Linux paketi yoxdur" : "Linux package is missing"}</span>
        </div>
        <p className="text-xs text-slate-500">{az ? "Mövcud deyilsə, AGENT_DOWNLOADS_DIR qovluğuna wearden-agent-linux-amd64 və SHA256SUMS faylını qoyun." : "If missing, place wearden-agent-linux-amd64 and SHA256SUMS in the AGENT_DOWNLOADS_DIR folder."}</p>
        <p className="text-xs text-slate-500">{az ? "Token yaratmaq və tək əmri görmək üçün Aktivlər səhifəsindəki Agentlər bölməsinə keçin." : "To create a token and see the one-line command, use the Agents section on the Assets page."}</p>
      </Card>
    </>
  );
}

function Users() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["users"], queryFn: usersApi.list });
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
  const update = useMutation({ mutationFn: (v: { id: number; role?: UserRow["role"]; active?: boolean }) => usersApi.update(v.id, { role: v.role, active: v.active }), onSuccess: refresh });
  const [form, setForm] = useState({ username: "", password: "", role: "viewer" as UserRow["role"] });
  const create = useMutation({ mutationFn: () => usersApi.create(form), onSuccess: () => { setForm({ username: "", password: "", role: "viewer" }); refresh(); } });
  const [reset, setReset] = useState<{ id: number; name: string; password: string } | null>(null);
  const doReset = useMutation({ mutationFn: () => usersApi.resetPassword(reset!.id, reset!.password), onSuccess: () => setReset(null) });
  const err = (update.error ?? create.error ?? doReset.error) as Error | null;
  return (
    <>
      <Card title={az ? "Yeni istifadəçi" : "Add a user"} hint={az ? "Müvəqqəti parol verin, istifadəçi ilk girişdə onu dəyişəcək." : "Give a temporary password; the user must change it at first sign-in."}>
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <input className={field} placeholder={az ? "İstifadəçi adı" : "Username"} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className={field} type="password" autoComplete="new-password" placeholder={az ? "Müvəqqəti parol (12+)" : "Temporary password (12+)"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRow["role"] })}>
            <option value="viewer">viewer</option><option value="operator">operator</option><option value="admin">admin</option>
          </select>
          <button className={btnPrimary} disabled={!form.username || form.password.length < 12 || create.isPending}>{az ? "Əlavə et" : "Add"}</button>
        </form>
        {err && <p className="text-xs text-red-300">{err.message}</p>}
      </Card>
      <Card title={az ? "İstifadəçilər" : "Users"} hint={az ? "viewer yalnız baxır, operator scan və hardening icra edir, admin hər şeyi idarə edir." : "Viewers only look, operators run scans and hardening, admins manage everything."}>
        {list.data?.length === 0 ? <EmptyState title={az ? "İstifadəçi yoxdur" : "No users"} /> : (
          <div className={tableWrap}>
            <table className="w-full text-left text-sm">
              <thead className={theadCls}><tr><th className="px-4 py-2.5 font-medium">{az ? "İstifadəçi" : "User"}</th><th className="px-4 py-2.5 font-medium">{az ? "Rol" : "Role"}</th><th className="px-4 py-2.5 font-medium">{az ? "Vəziyyət" : "State"}</th><th className="px-4 py-2.5 text-right font-medium">{az ? "Əməliyyat" : "Actions"}</th></tr></thead>
              <tbody className="divide-y divide-slate-800/70">
                {list.data?.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-900/60">
                    <td className="px-4 py-2.5"><span className="text-slate-100">{u.username}</span>{u.id === user?.id && <span className="ml-2 text-xs text-slate-500">({az ? "siz" : "you"})</span>}</td>
                    <td className="px-4 py-2.5">
                      <select className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs" disabled={u.id === user?.id} value={u.role} onChange={(e) => update.mutate({ id: u.id, role: e.target.value as UserRow["role"] })}>
                        <option value="viewer">viewer</option><option value="operator">operator</option><option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-300">
                      <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${u.active ? "bg-emerald-400" : "bg-slate-500"}`} />{u.active ? (az ? "aktiv" : "active") : az ? "bağlı" : "disabled"}</span>
                      {u.must_change_password && <span className="ml-2 text-slate-500">{az ? "parol dəyişməli" : "must change password"}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-2 text-xs">
                        <button className={btn + " !py-1"} onClick={() => setReset({ id: u.id, name: u.username, password: "" })}>{az ? "Parolu sıfırla" : "Reset password"}</button>
                        <button className={btn + " !py-1"} disabled={u.id === user?.id} onClick={() => update.mutate({ id: u.id, active: !u.active })}>{u.active ? (az ? "Bağla" : "Disable") : az ? "Aç" : "Enable"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {reset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <form className="w-full max-w-sm space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5" onSubmit={(e) => { e.preventDefault(); doReset.mutate(); }}>
            <h3 className="text-sm font-medium text-slate-100">{az ? "Parolu sıfırla" : "Reset password"}: {reset.name}</h3>
            <input autoFocus className={field} type="password" autoComplete="new-password" placeholder={az ? "Yeni müvəqqəti parol (12+)" : "New temporary password (12+)"} value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} />
            <p className="text-xs text-slate-500">{az ? "İstifadəçinin bütün sessiyaları bağlanır." : "All of this user's sessions are signed out."}</p>
            <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={() => setReset(null)}>{az ? "Ləğv et" : "Cancel"}</button><button className={btnPrimary} disabled={reset.password.length < 12 || doReset.isPending}>{az ? "Sıfırla" : "Reset"}</button></div>
          </form>
        </div>
      )}
    </>
  );
}

function About() {
  const { lang } = useI18n();
  const az = lang === "az";
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000 });
  const ready = useQuery({ queryKey: ["ready"], queryFn: api.ready, refetchInterval: 15_000 });
  const Row = ({ k, v, ok }: { k: string; v: string; ok?: boolean }) => (
    <div className="flex items-center justify-between border-b border-slate-800/70 py-2 text-sm last:border-0">
      <span className="text-slate-400">{k}</span>
      <span className="flex items-center gap-2 text-slate-100">{ok !== undefined && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />}{v}</span>
    </div>
  );
  return (
    <Card title={az ? "Sistem" : "System"}>
      <div>
        <Row k="API" v={health.data?.status === "ok" ? (az ? "işləyir" : "running") : az ? "əlçatmaz" : "unreachable"} ok={health.data?.status === "ok"} />
        <Row k={az ? "Verilənlər bazası" : "Database"} v={ready.data?.database === "ok" ? (az ? "qoşulub" : "connected") : az ? "mövcud deyil" : "unavailable"} ok={ready.data?.database === "ok"} />
        <Row k={az ? "Ünvan" : "Address"} v={window.location.origin} />
        <Row k={az ? "Agent protokolu" : "Agent protocol"} v="v1 (REST + JSON Schema)" />
      </div>
    </Card>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const isAdmin = user?.role === "admin";
  const [params, setParams] = useSearchParams();
  const section = (params.get("section") as Section) || "profile";
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.list, enabled: isAdmin });
  useEffect(() => {
    if (!isAdmin && ["ai", "agents", "users"].includes(section)) setParams({ section: "profile" }, { replace: true });
  }, [isAdmin, section, setParams]);

  const nav: { id: Section; label: string; admin?: boolean }[] = [
    { id: "profile", label: az ? "Profil" : "Profile" },
    { id: "appearance", label: az ? "Görünüş" : "Appearance" },
    { id: "ai", label: az ? "AI analiz" : "AI analysis", admin: true },
    { id: "agents", label: az ? "Agentlər və loglar" : "Agents and logs", admin: true },
    { id: "users", label: az ? "İstifadəçilər" : "Users and roles", admin: true },
    { id: "about", label: az ? "Sistem" : "System" },
  ];
  const rows = settings.data?.settings ?? [];
  const vaultReady = settings.data?.vault_ready ?? false;

  return (
    <div className="space-y-6">
      <PageHeader title={az ? "Parametrlər" : "Settings"} subtitle={az ? "Hesabınızı, görünüşü və platformanın işləməsini idarə edin." : "Manage your account, the appearance and how the platform runs."} />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="settings sections">
          {nav.filter((n) => !n.admin || isAdmin).map((n) => (
            <button key={n.id} onClick={() => setParams({ section: n.id })} aria-current={section === n.id ? "page" : undefined} className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-sm ${section === n.id ? "bg-slate-800 font-medium text-slate-50" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"}`}>{n.label}</button>
          ))}
        </nav>
        <div className="max-w-3xl space-y-5">
          {isAdmin && ["ai", "agents"].includes(section) && settings.data && !vaultReady && (
            <p className="rounded-md border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300">{az ? "WEARDEN_VAULT_KEY server mühitində təyin edilməyib, ona görə dəyərləri yadda saxlamaq olmur." : "WEARDEN_VAULT_KEY is not set in the server environment, so values cannot be saved yet."}</p>
          )}
          {section === "profile" && <Profile />}
          {section === "appearance" && <Appearance />}
          {section === "ai" && isAdmin && <AiSettings rows={rows} vaultReady={vaultReady} />}
          {section === "agents" && isAdmin && <AgentSettings rows={rows} vaultReady={vaultReady} />}
          {section === "users" && isAdmin && <Users />}
          {section === "about" && <About />}
        </div>
      </div>
    </div>
  );
}
