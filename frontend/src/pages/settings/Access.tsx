import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PermissionDef, registrationApi, RoleInput, rolesApi, RoleRow, UserRow, usersApi } from "../../settingsApi";
import { useAuth } from "../../auth";
import { useI18n } from "../../i18n";
import { useFeedback } from "../../components/feedback";
import DataTable, { Column } from "../../components/DataTable";
import { Chips, searchCls } from "../../components/ui";
import { btn, btnDanger, btnPrimary, btnSmall, Card, Dialog, errText, field, Labeled } from "../../components/settingsUi";

const LEVEL_RANK = { viewer: 1, operator: 2, admin: 3 } as const;

/** Plain wording for a role's base level, shown next to the role name in dropdowns. */
function levelLabel(level: RoleRow["level"], az: boolean): string {
  if (level === "admin") return az ? "tam giriş" : "full access";
  if (level === "operator") return az ? "oxuma və yazma" : "read and write";
  return az ? "yalnız oxuma" : "read only";
}

/** A strong random password that satisfies common policies; shown once so it can be handed over. */
function generatePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*-_=+"];
  const all = sets.join("");
  const pick = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];
  const out = sets.map(pick);
  while (out.length < 18) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

function useRoles() {
  return useQuery({ queryKey: ["roles"], queryFn: rolesApi.list });
}

/** The signed-in user may only hand out access they hold themselves. */
function useCanGrant() {
  const { user } = useAuth();
  return (role: RoleRow) => !!user && LEVEL_RANK[role.level] <= LEVEL_RANK[user.level] && role.permissions.every((p) => user.permissions.includes(p));
}

function LevelBadge({ level }: { level: RoleRow["level"] }) {
  const tone = level === "admin" ? "border-slate-300 text-slate-100" : level === "operator" ? "border-slate-600 text-slate-300" : "border-slate-800 text-slate-400";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>{level}</span>;
}

function UserDialog({ roles, onClose }: { roles: RoleRow[]; onClose: () => void }) {
  const { lang } = useI18n();
  const az = lang === "az";
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const canGrant = useCanGrant();
  const options = roles.filter((r) => r.name !== "admin" && canGrant(r));
  const [form, setForm] = useState({ username: "", password: generatePassword(), role: options.find((r) => r.name === "viewer")?.name ?? options[0]?.name ?? "viewer" });
  const [shown, setShown] = useState(true);
  const create = useMutation({
    mutationFn: () => usersApi.create(form),
    onSuccess: () => {
      toast(az ? "İstifadəçi əlavə edildi." : "User added.", "success");
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["roles"] });
      onClose();
    },
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(form.password);
      toast(az ? "Parol kopyalandı." : "Password copied.", "success");
    } catch {
      toast(az ? "Kopyalamaq alınmadı." : "Copy failed.", "error");
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Dialog title={az ? "Yeni istifadəçi" : "Add a user"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Labeled label={az ? "İstifadəçi adı" : "Username"} hint={az ? "3 ilə 64 simvol: hərf, rəqəm, nöqtə, tire, alt xətt." : "3 to 64 characters: letters, digits, dot, dash, underscore."}>
          <input autoFocus className={`${field} h-9`} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
        </Labeled>
        <Labeled label={az ? "Müvəqqəti parol" : "Temporary password"} hint={az ? "İstifadəçi ilk girişdə onu dəyişməlidir. Bu pəncərə bağlandıqdan sonra parol bir daha göstərilmir." : "The user must change it at first sign-in. It is not shown again after you close this window."}>
          <div className="flex gap-2">
            <input className={`${field} h-9 flex-1 font-mono`} type={shown ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            <button type="button" className={btn} onClick={() => setShown(!shown)}>{shown ? (az ? "Gizlət" : "Hide") : az ? "Göstər" : "Show"}</button>
            <button type="button" className={btn} onClick={() => setForm({ ...form, password: generatePassword() })}>{az ? "Yenisi" : "Generate"}</button>
            <button type="button" className={btn} onClick={copy}>{az ? "Kopyala" : "Copy"}</button>
          </div>
        </Labeled>
        <Labeled label={az ? "Rol" : "Role"}>
          <select className={`${field} h-9`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {options.map((r) => <option key={r.name} value={r.name}>{r.name} ({levelLabel(r.level, az)})</option>)}
          </select>
        </Labeled>
        {create.error && <p className="text-xs text-red-300">{errText(create.error)}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
          <button type="button" className={btn} onClick={onClose}>{az ? "Ləğv et" : "Cancel"}</button>
          <button className={btnPrimary} disabled={create.isPending || form.username.length < 3 || form.password.length < 12}>{az ? "Əlavə et" : "Add user"}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function Users() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const canGrant = useCanGrant();
  const list = useQuery({ queryKey: ["users"], queryFn: usersApi.list });
  const roles = useRoles();
  const roleRows = roles.data?.roles ?? [];
  const [q, setQ] = useState("");
  const [state, setState] = useState<"all" | "active" | "disabled" | "pending">("all");
  const [adding, setAdding] = useState(false);
  const [reset, setReset] = useState<{ id: number; name: string; password: string } | null>(null);
  const refresh = (msg: string) => {
    toast(msg, "success");
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["roles"] });
  };
  const update = useMutation({
    mutationFn: (v: { id: number; role?: string; active?: boolean }) => usersApi.update(v.id, { role: v.role, active: v.active }),
    onSuccess: () => refresh(az ? "İstifadəçi yeniləndi." : "User updated."),
    onError: (e) => toast(errText(e), "error"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => usersApi.remove(id),
    onSuccess: () => refresh(az ? "İstifadəçi silindi." : "User deleted."),
    onError: (e) => toast(errText(e), "error"),
  });
  const approve = useMutation({
    mutationFn: (id: number) => usersApi.approve(id),
    onSuccess: () => refresh(az ? "İstifadəçi təsdiqləndi." : "User approved."),
    onError: (e) => toast(errText(e), "error"),
  });
  const reg = useQuery({ queryKey: ["registration"], queryFn: registrationApi.get });
  const setReg = useMutation({
    mutationFn: (open: boolean) => registrationApi.set(open),
    onSuccess: (r) => { toast(r.open ? (az ? "Qeydiyyat açıldı." : "Registration opened.") : az ? "Qeydiyyat bağlandı." : "Registration closed.", "success"); qc.invalidateQueries({ queryKey: ["registration"] }); },
    onError: (e) => toast(errText(e), "error"),
  });
  const pendingCount = (list.data ?? []).filter((u) => u.pending).length;
  const doReset = useMutation({
    mutationFn: () => usersApi.resetPassword(reset!.id, reset!.password),
    onSuccess: () => { setReset(null); toast(az ? "Parol sıfırlandı." : "Password reset.", "success"); },
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data ?? []).filter((u) => (state === "all" || (state === "pending" ? u.pending : state === "active" ? u.active : !u.active && !u.pending)) && (!needle || `${u.username} ${u.role}`.toLowerCase().includes(needle)));
  }, [list.data, q, state]);
  const manageable = (u: UserRow) => {
    const r = roleRows.find((x) => x.name === u.role);
    return u.id !== user?.id && (!r || canGrant(r));
  };

  const columns: Column<UserRow>[] = [
    { id: "user", header: az ? "İstifadəçi" : "User", locked: true, sort: (a, b) => a.username.localeCompare(b.username), csv: (u) => u.username, cell: (u) => (
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-100">{u.username[0]?.toUpperCase()}</span>
        <span className="text-slate-100">{u.username}{u.id === user?.id && <span className="ml-2 text-xs text-slate-500">({az ? "siz" : "you"})</span>}</span>
      </div>
    ) },
    { id: "role", header: az ? "Rol" : "Role", sort: (a, b) => a.role.localeCompare(b.role), csv: (u) => u.role, cell: (u) => (
      <select className="h-8 rounded-md border border-slate-800 bg-slate-950 px-2 text-xs" disabled={!manageable(u)} value={u.role} onChange={(e) => update.mutate({ id: u.id, role: e.target.value })}>
        {!roleRows.some((r) => r.name === u.role) && <option value={u.role}>{u.role}</option>}
        {roleRows.map((r) => <option key={r.name} value={r.name} disabled={!canGrant(r) || (r.name === "admin" && u.role !== "admin")}>{r.name} ({levelLabel(r.level, az)})</option>)}
      </select>
    ) },
    { id: "state", header: az ? "Vəziyyət" : "State", sort: (a, b) => Number(a.active) - Number(b.active), csv: (u) => (u.active ? "active" : "disabled"), cell: (u) => (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-300"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${u.pending ? "bg-amber-400" : u.active ? "bg-emerald-400" : "bg-slate-500"}`} />{u.pending ? (az ? "təsdiq gözləyir" : "awaiting approval") : u.active ? (az ? "aktiv" : "active") : az ? "bağlı" : "disabled"}{u.must_change_password && <span className="ml-2 text-slate-500">{az ? "parol dəyişməli" : "must change password"}</span>}</span>
    ) },
    { id: "created", header: az ? "Yaradılıb" : "Created", defaultHidden: true, sort: (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at), csv: (u) => u.created_at, cell: (u) => <span className="text-xs text-slate-500">{new Date(u.created_at).toLocaleDateString()}</span> },
    { id: "actions", header: "", locked: true, className: "text-right", cell: (u) => (
      <div className="flex justify-end gap-2">
        <button className={btnSmall} disabled={!manageable(u) && u.id !== user?.id} onClick={() => setReset({ id: u.id, name: u.username, password: generatePassword() })}>{az ? "Parolu sıfırla" : "Reset password"}</button>
        {u.pending
          ? <button className={btnPrimary + " !h-8 !px-2.5 !text-xs"} disabled={!manageable(u) || approve.isPending} onClick={() => approve.mutate(u.id)}>{az ? "Təsdiqlə" : "Approve"}</button>
          : <button className={btnSmall} disabled={!manageable(u)} onClick={() => update.mutate({ id: u.id, active: !u.active })}>{u.active ? (az ? "Bağla" : "Disable") : az ? "Aç" : "Enable"}</button>}
        <button className={btnDanger} disabled={!manageable(u)} onClick={async () => (await confirm({ title: az ? `${u.username} silinsin?` : `Delete ${u.username}?`, message: az ? "İstifadəçi və onun bütün sessiyaları silinir. Bu geri qaytarılmır." : "The user and all of their sessions are removed. This cannot be undone.", confirmLabel: az ? "Sil" : "Delete", cancelLabel: az ? "Vaz keç" : "Cancel", danger: true })) && remove.mutate(u.id)}>{u.pending ? (az ? "Rədd et" : "Reject") : az ? "Sil" : "Delete"}</button>
      </div>
    ) },
  ];

  return (
    <>
      <Card
        title={az ? "Qeydiyyat" : "Registration"}
        hint={az ? "Hər kəs login səhifəsindən hesab sorğusu göndərə bilər. Sorğu təsdiqinizi gözləyir və hesab viewer olur. Yeganə administrator ilk qeydiyyatdan keçən şəxsdir." : "Anyone can request an account on the sign-in page. A request waits for your approval and becomes a viewer. The only administrator is whoever registered first."}
        action={
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={reg.data?.open ?? true} disabled={reg.isLoading || setReg.isPending} onChange={(e) => setReg.mutate(e.target.checked)} />
            {az ? "Qeydiyyat açıqdır" : "Registration open"}
          </label>
        }
      >
        <p className="text-xs text-slate-500">{pendingCount > 0 ? (az ? `${pendingCount} sorğu təsdiq gözləyir.` : `${pendingCount} request${pendingCount === 1 ? " is" : "s are"} waiting for approval.`) : az ? "Gözləyən sorğu yoxdur." : "No requests are waiting."}</p>
      </Card>
      <Card
        title={az ? "İstifadəçilər" : "Users"}
        hint={az ? "İstifadəçi əlavə edin, rolunu dəyişin, bağlayın və ya silin. Son aktiv administratoru silmək olmaz." : "Add users, change their role, disable or delete them. The last active administrator cannot be removed."}
        action={<button className={btnPrimary} onClick={() => setAdding(true)}>{az ? "İstifadəçi əlavə et" : "Add user"}</button>}
      >
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(u) => u.id}
          storageKey="users"
          exportName="wearden-users"
          loading={list.isLoading}
          pageSizes={[10, 25, 50]}
          emptyTitle={az ? "İstifadəçi tapılmadı" : "No users found"}
          filterState={{ value: { q, state }, onChange: (v) => { const f = v as { q: string; state: typeof state }; setQ(f.q ?? ""); setState(f.state ?? "all"); } }}
          toolbar={
            <>
              <input type="search" className={`${searchCls} !w-56`} placeholder={az ? "Ad və ya rol" : "Search name or role"} value={q} onChange={(e) => setQ(e.target.value)} />
              <Chips label="state" value={state} onChange={setState} options={[{ id: "all", label: az ? "Hamısı" : "All" }, { id: "pending", label: az ? "Gözləyən" : "Pending", count: pendingCount }, { id: "active", label: az ? "Aktiv" : "Active" }, { id: "disabled", label: az ? "Bağlı" : "Disabled" }]} />
            </>
          }
        />
        {list.error && <p className="text-xs text-red-300">{errText(list.error)}</p>}
      </Card>
      {adding && roleRows.length > 0 && <UserDialog roles={roleRows} onClose={() => setAdding(false)} />}
      {reset && (
        <Dialog title={`${az ? "Parolu sıfırla" : "Reset password"}: ${reset.name}`} onClose={() => setReset(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); doReset.mutate(); }}>
            <Labeled label={az ? "Yeni müvəqqəti parol" : "New temporary password"} hint={az ? "İstifadəçinin bütün sessiyaları bağlanır və o, parolu dəyişməlidir." : "All of this user's sessions are signed out and they must change it."}>
              <div className="flex gap-2">
                <input autoFocus className={`${field} h-9 flex-1 font-mono`} value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} autoComplete="new-password" />
                <button type="button" className={btn} onClick={() => setReset({ ...reset, password: generatePassword() })}>{az ? "Yenisi" : "Generate"}</button>
              </div>
            </Labeled>
            {doReset.error && <p className="text-xs text-red-300">{errText(doReset.error)}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
              <button type="button" className={btn} onClick={() => setReset(null)}>{az ? "Ləğv et" : "Cancel"}</button>
              <button className={btnPrimary} disabled={reset.password.length < 12 || doReset.isPending}>{az ? "Sıfırla" : "Reset"}</button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

function RoleDialog({ initial, permissions, onClose }: { initial: RoleRow | null; permissions: PermissionDef[]; onClose: () => void }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState<RoleInput>({ name: initial?.name ?? "", description: initial?.description ?? "", level: initial && initial.level !== "admin" ? initial.level : "viewer", permissions: initial?.permissions ?? [] });
  const save = useMutation({
    mutationFn: () => (initial ? rolesApi.update(form) : rolesApi.create(form)),
    onSuccess: () => {
      toast(initial ? (az ? "Rol yeniləndi." : "Role updated.") : az ? "Rol yaradıldı." : "Role created.", "success");
      qc.invalidateQueries({ queryKey: ["roles"] });
      onClose();
    },
  });
  const groups = useMemo(() => Array.from(new Set(permissions.map((p) => p.group))), [permissions]);
  const toggle = (id: string) => setForm({ ...form, permissions: form.permissions.includes(id) ? form.permissions.filter((p) => p !== id) : [...form.permissions, id] });
  return (
    <Dialog title={initial ? `${az ? "Rolu redaktə et" : "Edit role"}: ${initial.name}` : az ? "Yeni rol" : "New role"} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label={az ? "Ad" : "Name"} hint={az ? "Kiçik hərf, rəqəm, tire, alt xətt (2 ilə 32)." : "Lowercase letters, digits, dash, underscore (2 to 32)."}>
            <input autoFocus={!initial} disabled={!!initial} className={`${field} h-9`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} placeholder="auditor" />
          </Labeled>
          <Labeled label={az ? "Baza səviyyə" : "Base level"} hint={az ? "viewer yalnız baxır. operator scan və hardening icra edir." : "Viewer only looks. Operator runs scans and hardening."}>
            <select className={`${field} h-9`} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as RoleInput["level"] })}>
              <option value="viewer">viewer</option>
              <option value="operator">operator</option>
            </select>
          </Labeled>
        </div>
        <Labeled label={az ? "Təsvir" : "Description"}>
          <input className={`${field} h-9`} value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Labeled>
        <div className="space-y-3">
          <div className="text-xs font-medium text-slate-300">{az ? "Əlavə icazələr" : "Extra permissions"}</div>
          {groups.map((g) => (
            <fieldset key={g} className="rounded-lg border border-slate-800 p-3">
              <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-500">{g}</legend>
              <div className="space-y-1.5">
                {permissions.filter((p) => p.group === g).map((p) => {
                  const held = !!user?.permissions.includes(p.id);
                  return (
                    <label key={p.id} className={`flex items-start gap-2 text-sm ${held ? "text-slate-200" : "text-slate-600"}`} title={held ? undefined : az ? "Siz bu icazəyə sahib deyilsiniz" : "You do not hold this permission"}>
                      <input type="checkbox" className="mt-1" disabled={!held} checked={form.permissions.includes(p.id)} onChange={() => toggle(p.id)} />
                      <span><span className="font-mono text-xs text-slate-400">{p.id}</span><span className="block text-xs">{p.label}</span></span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        {save.error && <p className="text-xs text-red-300">{errText(save.error)}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
          <button type="button" className={btn} onClick={onClose}>{az ? "Ləğv et" : "Cancel"}</button>
          <button className={btnPrimary} disabled={save.isPending || form.name.length < 2}>{az ? "Saxla" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function Roles() {
  const { lang } = useI18n();
  const az = lang === "az";
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const { can } = useAuth();
  const canGrant = useCanGrant();
  const roles = useRoles();
  const [dialog, setDialog] = useState<RoleRow | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (name: string) => rolesApi.remove(name),
    onSuccess: () => { toast(az ? "Rol silindi." : "Role deleted.", "success"); qc.invalidateQueries({ queryKey: ["roles"] }); },
    onError: (e) => toast(errText(e), "error"),
  });
  const catalog = roles.data?.permissions ?? [];
  const label = (id: string) => catalog.find((p) => p.id === id)?.label ?? id;
  const manage = can("roles.manage");
  return (
    <>
      <Card
        title={az ? "Rollar və icazələr" : "Roles and permissions"}
        hint={az ? "Hər rolun baza səviyyəsi (viewer, operator) və əlavə inzibati icazələri var. Admin hər şeyə sahibdir. Rol yalnız sizdə olan icazələri verə bilər." : "Each role has a base level (viewer, operator) plus extra administrative permissions. Admin holds everything. A role can only grant permissions you hold yourself."}
        action={manage ? <button className={btnPrimary} onClick={() => setDialog("new")}>{az ? "Yeni rol" : "New role"}</button> : undefined}
      >
        {roles.isLoading && <p className="text-sm text-slate-500">{az ? "Yüklənir..." : "Loading..."}</p>}
        {roles.error && <p className="text-sm text-red-300">{errText(roles.error)}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {(roles.data?.roles ?? []).map((r) => (
            <div key={r.name} className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-950 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-50">{r.name}</span>
                  <LevelBadge level={r.level} />
                  {r.builtin && <span className="rounded-full border border-slate-800 px-2 py-0.5 text-[11px] text-slate-500">{az ? "daxili" : "built in"}</span>}
                </div>
                <p className="mt-1 text-xs text-slate-400">{r.description || (az ? "Təsvir yoxdur." : "No description.")}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.permissions.length === 0 ? <span className="text-xs text-slate-600">{az ? "Əlavə icazə yoxdur" : "No extra permissions"}</span> : r.permissions.map((p) => <span key={p} title={label(p)} className="rounded border border-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{p}</span>)}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{r.users} {az ? "istifadəçi" : r.users === 1 ? "user" : "users"}</span>
                {!r.builtin && manage && (
                  <div className="flex gap-2">
                    <button className={btnSmall} disabled={!canGrant(r)} onClick={() => setDialog(r)}>{az ? "Redaktə" : "Edit"}</button>
                    <button className={btnDanger} disabled={r.users > 0 || !canGrant(r)} title={r.users > 0 ? (az ? "Əvvəl istifadəçiləri başqa rola keçirin" : "Reassign its users first") : undefined} onClick={async () => (await confirm({ title: az ? `${r.name} silinsin?` : `Delete role ${r.name}?`, confirmLabel: az ? "Sil" : "Delete", cancelLabel: az ? "Vaz keç" : "Cancel", danger: true })) && remove.mutate(r.name)}>{az ? "Sil" : "Delete"}</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title={az ? "İcazə kataloqu" : "Permission catalog"} hint={az ? "Hansı icazə nəyi açır." : "What each permission unlocks."}>
        <dl className="divide-y divide-slate-800/70 text-sm">
          {catalog.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-4 py-2">
              <dt className="font-mono text-xs text-slate-300">{p.id}</dt>
              <dd className="text-right text-xs text-slate-400">{p.label}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {dialog && <RoleDialog initial={dialog === "new" ? null : dialog} permissions={catalog} onClose={() => setDialog(null)} />}
    </>
  );
}
