import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { pamApi, PamTestResult } from "../pamApi";
import { openSession } from "../components/openSession";
import type { SessionOpenResult } from "../sessionTypes";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useFeedback } from "../components/feedback";
import AssetModal from "../components/AssetModal";
import CredentialModal from "../components/CredentialModal";
import RemoteSession from "../components/RemoteSession";
import StatusDot from "../components/StatusDot";
import HostIcon from "../components/HostIcon";
import DataTable, { Column } from "../components/DataTable";
import { Chips, PageHeader, searchCls } from "../components/ui";
import { isPam } from "../types";
import type { Asset, AssetInput, CredentialInput } from "../types";

/**
 * PAM assets: hosts that core manages over SSH or WinRM with a stored credential, without an agent.
 * Scans, hardening and rollback for them start from the PAM scans and PAM hardening pages.
 */
export default function PamAssets() {
  const { user, can } = useAuth();
  const { t, lang } = useI18n();
  const az = lang === "az";
  const L = (en: string, a: string) => (az ? a : en);
  const queryClient = useQueryClient();
  const { confirm, toast } = useFeedback();
  const canOperate = user?.level === "admin" || user?.level === "operator";
  const canDelete = can("assets.delete");
  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list, refetchInterval: 10_000 });
  const [editing, setEditing] = useState<Asset | "new" | null>(null);
  const [credFor, setCredFor] = useState<Asset | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [keyCheck, setKeyCheck] = useState<{ asset: Asset; result: PamTestResult } | null>(null);
  const [live, setLive] = useState<SessionOpenResult | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [via, setVia] = useState<"all" | "ssh" | "winrm">("all");

  const all = useMemo(() => (assets.data ?? []).filter(isPam), [assets.data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((a) => (via === "all" || a.connection === via) && (!needle || `${a.name} ${a.host} ${a.os_detected ?? ""} ${a.tags.join(" ")}`.toLowerCase().includes(needle)));
  }, [all, q, via]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["assets"] });

  const showResult = (asset: Asset, res: PamTestResult) => {
    if (res.status === "confirm_host_key") {
      setKeyCheck({ asset, result: res });
    } else if (res.status === "ok") {
      toast(`${asset.name}: ${L("connected", "qoşuldu")} (${res.os_detected ?? asset.os_type}, ${res.privilege ?? ""})`, "success");
    } else {
      toast(`${asset.name}: ${res.detail ?? L("connection failed", "qoşulma alınmadı")}`, "error");
    }
  };

  const test = async (asset: Asset, hostKey = "", replace = false) => {
    setTesting(asset.id);
    try {
      showResult(asset, await pamApi.test(asset.id, hostKey, replace));
      await refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setTesting(null);
    }
  };

  const connect = async (asset: Asset) => {
    setOpening(asset.id);
    try {
      const session = await openSession(asset, confirm, az, t("common.cancel"));
      if (session) setLive(session);
    } catch (err) {
      toast(`${t("assets.sessionFail")}: ${(err as Error).message}`, "error");
    } finally {
      setOpening(null);
    }
  };

  const save = async (body: AssetInput) => {
    if (editing && editing !== "new") await assetsApi.update(editing.id, body);
    else await assetsApi.create(body);
    setEditing(null);
    await refresh();
  };

  const saveCredential = async (body: CredentialInput) => {
    if (!credFor) return;
    await assetsApi.setCredential(credFor.id, body);
    toast(t("assets.credSaved").replace("{name}", credFor.name), "success");
    setCredFor(null);
    await refresh();
  };

  const remove = async (asset: Asset) => {
    if (!(await confirm({ title: t("assets.confirmDelete").replace("{name}", asset.name), confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true }))) return;
    try {
      await assetsApi.remove(asset.id);
      await refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const btn = "inline-flex h-8 items-center rounded border border-slate-700 px-2 text-xs hover:bg-slate-800 disabled:opacity-40";
  const columns: Column<Asset>[] = [
    { id: "status", header: t("col.status"), sort: (x, y) => x.status.localeCompare(y.status), csv: (a) => a.status, cell: (a) => <StatusDot status={a.status} /> },
    { id: "name", wide: true, header: t("col.name"), locked: true, sort: (x, y) => x.name.localeCompare(y.name), csv: (a) => a.name, cell: (a) => (
      <div className="flex items-center gap-3">
        <HostIcon os={a.os_type} size={28} />
        <div>
          <div className="font-medium text-slate-50">{a.name}</div>
          {a.tags.length > 0 && <div className="text-xs text-slate-500">{a.tags.join(" · ")}</div>}
        </div>
      </div>
    ) },
    { id: "host", header: "Host", sort: (x, y) => x.host.localeCompare(y.host), csv: (a) => a.host, cell: (a) => <span className="font-mono text-xs">{a.host}</span> },
    { id: "via", header: L("Connection", "Bağlantı"), sort: (x, y) => (x.connection ?? "").localeCompare(y.connection ?? ""), csv: (a) => a.connection ?? "", cell: (a) => (
      <div>
        <div>{a.connection === "winrm" ? "WinRM" : "SSH"}</div>
        <div className="text-xs text-slate-500">{a.credential_username ? `${a.credential_username}${a.privilege ? ` · ${a.privilege}` : ""}` : L("no credential", "etimad məlumatı yoxdur")}</div>
      </div>
    ) },
    { id: "os", header: t("col.os"), sort: (x, y) => (x.os_detected ?? "").localeCompare(y.os_detected ?? ""), csv: (a) => a.os_detected ?? a.os_type, cell: (a) => <span>{a.os_detected ?? a.os_version ?? (a.os_type === "linux" ? "Linux" : "Windows")}</span> },
    { id: "actions", header: t("col.actions"), locked: true, className: "text-right", cell: (a) => (
      <div className="flex flex-wrap justify-end gap-2" onClick={(e) => e.stopPropagation()}>
        {canOperate && (
          <>
            <button onClick={() => test(a)} disabled={!a.credential_username || testing === a.id} className={btn} title={a.credential_username ? undefined : t("assets.setCredFirst")}>
              {testing === a.id ? L("Testing...", "Yoxlanılır...") : L("Test connection", "Bağlantını yoxla")}
            </button>
            <button onClick={() => connect(a)} disabled={!a.credential_username || opening === a.id} className="inline-flex h-8 items-center rounded bg-cyan-700 px-2 text-xs text-white hover:bg-cyan-600 disabled:opacity-40" title={L("Interactive SSH or RDP session, recorded", "İnteraktiv SSH və ya RDP sessiyası, yazılır")}>
              {opening === a.id ? t("assets.opening") : t("common.connect")}
            </button>
            <button onClick={() => setCredFor(a)} className={btn}>{t("assets.credential")}</button>
            <button onClick={() => setEditing(a)} className={btn}>{t("common.edit")}</button>
          </>
        )}
        {canDelete && <button onClick={() => remove(a)} className="inline-flex h-8 items-center rounded border border-red-900 px-2 text-xs text-red-400 hover:bg-red-950/50">{t("common.delete")}</button>}
      </div>
    ) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={L("PAM assets", "PAM aktivləri")}
        subtitle={L(
          "Hosts managed over SSH or WinRM with a stored credential, without an agent. Test the connection once to confirm the SSH host key, then scan and harden them from the PAM pages.",
          "Agentsiz, saxlanılan etimad məlumatı ilə SSH və ya WinRM üzərindən idarə olunan hostlar. SSH host açarını təsdiqləmək üçün bağlantını bir dəfə yoxlayın, sonra PAM səhifələrindən skan və möhkəmləndirmə edin.",
        )}
        action={canOperate && <button onClick={() => setEditing("new")} className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500">{L("Add PAM asset", "PAM aktivi əlavə et")}</button>}
      />
      {assets.error && <p className="text-red-400">{(assets.error as Error).message}</p>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(a) => a.id}
        storageKey="pam-assets"
        exportName="wearden-pam-hosts"
        loading={assets.isLoading}
        initialSort={{ id: "name", dir: "asc" }}
        emptyTitle={all.length === 0 ? L("No PAM assets yet", "Hələ PAM aktivi yoxdur") : L("No matching hosts", "Uyğun host yoxdur")}
        emptyHint={all.length === 0 ? L("Add a host, store its credential and test the connection.", "Host əlavə edin, etimad məlumatını saxlayın və bağlantını yoxlayın.") : undefined}
        toolbar={
          <>
            <input type="search" className={`${searchCls} !w-64`} placeholder={L("Search name, address, OS or tag", "Ad, ünvan, OS və ya etiket")} value={q} onChange={(e) => setQ(e.target.value)} />
            <Chips label="connection" value={via} onChange={setVia} options={[{ id: "all", label: L("All", "Hamısı") }, { id: "ssh", label: "SSH" }, { id: "winrm", label: "WinRM" }]} />
          </>
        }
      />
      {editing && <AssetModal kind="pam" initial={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
      {credFor && <CredentialModal asset={credFor} onSave={saveCredential} onClose={() => setCredFor(null)} />}
      {keyCheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold">{L("Confirm the SSH host key", "SSH host açarını təsdiqləyin")}: {keyCheck.asset.name}</h2>
            <p className={keyCheck.result.host_key_changed ? "text-sm text-red-300" : "text-sm text-amber-300"}>
              {keyCheck.result.host_key_changed
                ? L("This host key differs from the key confirmed earlier. Continue only if the host was reinstalled.", "Bu host açarı əvvəl təsdiqlənəndən fərqlidir. Yalnız host yenidən qurulubsa davam edin.")
                : L("Compare it with the key on the host before the credential is sent.", "Etimad məlumatı göndərilməzdən əvvəl onu hostdakı açarla müqayisə edin.")}
            </p>
            <code className="block break-all select-all rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs">{keyCheck.result.host_key_type} {keyCheck.result.host_key}</code>
            <div className="flex justify-end gap-3">
              <button onClick={() => setKeyCheck(null)} className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">{t("common.cancel")}</button>
              <button
                onClick={() => { const k = keyCheck; setKeyCheck(null); test(k.asset, k.result.host_key ?? "", !!k.result.host_key_changed); }}
                className="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500"
              >
                {L("Trust and test", "Etibar et və yoxla")}
              </button>
            </div>
          </div>
        </div>
      )}
      {live && <RemoteSession session={live} onClose={() => setLive(null)} />}
    </div>
  );
}
