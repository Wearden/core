import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { agentsApi } from "../agentsApi";
import { benchmarksApi } from "../benchmarksApi";
import { scansApi } from "../scansApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useFeedback } from "../components/feedback";
import { useHostsSocket } from "../hooks/useHostsSocket";
import AssetModal from "../components/AssetModal";
import AgentManagement from "../components/AgentManagement";
import CredentialModal from "../components/CredentialModal";
import RemoteInstallModal from "../components/RemoteInstallModal";
import RemoteSession from "../components/RemoteSession";
import { sessionsApi } from "../sessionsApi";
import type { SessionOpenResult } from "../sessionTypes";
import Sparkline from "../components/Sparkline";
import StatusDot from "../components/StatusDot";
import HostIcon from "../components/HostIcon";
import DataTable, { Column } from "../components/DataTable";
import { Chips, searchCls } from "../components/ui";
import AssetDrawer, { DrawerTab } from "../components/AssetDrawer";
import type { Asset, AssetInput, CredentialInput } from "../types";

function secondsAgo(iso: string | null, now: number, ago: string, never: string): string {
  if (!iso) return never;
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return `${s} ${ago}`;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export default function Assets() {
  const { user, can } = useAuth();
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, toast } = useFeedback();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const openHost = Number(params.get("host")) || null;
  const drawerTab = (params.get("tab") as DrawerTab) || "overview";
  const openDrawer = (id: number, tab: DrawerTab = "overview") => setParams({ host: String(id), tab });
  const closeDrawer = () => setParams({});
  const { connected } = useHostsSocket();
  const now = useNow();

  const canOperate = user?.level === "admin" || user?.level === "operator";
  const isAdmin = can("assets.delete");

  const { data: assets = [], isLoading, error } = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list, refetchInterval: 10_000 });

  const [editing, setEditing] = useState<Asset | null | "new">(null);
  const [credFor, setCredFor] = useState<Asset | null>(null);
  const [installFor, setInstallFor] = useState<Asset | null>(null);
  const canEnroll = can("agents.enroll");
  // Shares the agent list cache with AgentManagement to know which hosts already have an agent.
  const agentRows = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list, refetchInterval: 10_000, enabled: canEnroll });
  const enrolledAssets = useMemo(() => new Set((agentRows.data ?? []).filter((g) => g.status !== "revoked" && g.asset_id !== undefined).map((g) => g.asset_id)), [agentRows.data]);
  const [flash, setFlash] = useState<string | null>(null);
  const [live, setLive] = useState<SessionOpenResult | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [osFilter, setOsFilter] = useState<"all" | "linux" | "windows">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [picked, setPicked] = useState<Set<string | number>>(new Set());
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return assets.filter((a) =>
      (osFilter === "all" || a.os_type === osFilter) &&
      (statusFilter === "all" || (statusFilter === "online" ? a.status === "online" || a.status === "degraded" : a.status !== "online" && a.status !== "degraded")) &&
      (!needle || `${a.name} ${a.host} ${a.os_detected ?? ""} ${a.tags.join(" ")}`.toLowerCase().includes(needle)));
  }, [assets, q, osFilter, statusFilter]);
  // One scan per benchmark: selected hosts are grouped by the original benchmark of their agent.
  const scanMany = async () => {
    const ids = Array.from(picked).map(Number);
    try {
      const agents = await agentsApi.list();
      const groups = new Map<string, number[]>();
      for (const id of ids) {
        const ag = agents.find((x) => x.asset_id === id && x.status !== "revoked");
        if (!ag) continue;
        const bid = ag.benchmark_id.replace(/-native(-registry)?$/, "-cis");
        groups.set(bid, [...(groups.get(bid) ?? []), id]);
      }
      if (groups.size === 0) { toast(lang === "az" ? "Seçilmiş hostlarda aktiv agent yoxdur." : "None of the selected hosts has an active agent.", "error"); return; }
      let last: string | null = null;
      for (const [bid, assetIds] of groups) {
        const profiles = await benchmarksApi.profiles(bid);
        last = (await scansApi.create({ name: `Bulk scan ${assetIds.length} hosts`, benchmark_id: bid, profile_id: profiles[0].id, asset_ids: assetIds })).id;
      }
      setPicked(new Set());
      toast(lang === "az" ? "Yoxlama növbəyə qoyuldu." : "Scan queued.", "success");
      if (groups.size === 1 && last) navigate(`/scans/${last}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const removeMany = async () => {
    const ids = Array.from(picked).map(Number);
    if (!(await confirm({ title: lang === "az" ? `${ids.length} host silinsin?` : `Delete ${ids.length} selected hosts?`, confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true }))) return;
    await Promise.allSettled(ids.map((id) => assetsApi.remove(id)));
    setPicked(new Set());
    await refresh();
  };

  const connect = async (asset: Asset) => {
    setOpening(asset.id);
    setFlash(null);
    try {
      setLive(await sessionsApi.open(asset.id, Math.max(640, window.innerWidth - 340), Math.max(480, window.innerHeight - 60)));
    } catch (err) {
      setFlash(`${t("assets.sessionFail")}: ${err instanceof Error ? err.message : t("assets.unknownErr")}`);
    } finally {
      setOpening(null);
    }
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["assets"] });

  const saveAsset = async (body: AssetInput) => {
    if (editing && editing !== "new") await assetsApi.update(editing.id, body);
    else await assetsApi.create(body);
    setEditing(null);
    await refresh();
  };

  const saveCredential = async (body: CredentialInput) => {
    if (!credFor) return;
    await assetsApi.setCredential(credFor.id, body);
    setCredFor(null);
    setFlash(t("assets.credSaved").replace("{name}", credFor.name));
    await refresh();
  };

  const remove = useMutation({
    mutationFn: (id: number) => assetsApi.remove(id),
    onSuccess: refresh,
  });

  const columns: Column<Asset>[] = [
    { id: "status", header: t("col.status"), sort: (x, y) => x.status.localeCompare(y.status), csv: (a) => a.status, cell: (a) => (
      <div><StatusDot status={a.status} /><div className="mt-1 text-xs text-slate-500">{secondsAgo(a.last_checked, now, t("assets.ago"), t("assets.never"))}</div></div>
    ) },
    { id: "name", header: t("col.name"), locked: true, sort: (x, y) => x.name.localeCompare(y.name), csv: (a) => a.name, cell: (a) => (
      <div className="flex items-center gap-3">
        <HostIcon os={a.os_type} size={28} />
        <div>
          <div className="font-medium text-slate-50">{a.name}</div>
          {a.tags.length > 0 && <div className="text-xs text-slate-500">{a.tags.join(" · ")}</div>}
        </div>
      </div>
    ) },
    { id: "host", header: "Host", sort: (x, y) => x.host.localeCompare(y.host), csv: (a) => a.host, cell: (a) => <span className="font-mono text-xs">{a.host}</span> },
    { id: "os", header: t("col.os"), sort: (x, y) => (x.os_detected ?? "").localeCompare(y.os_detected ?? ""), csv: (a) => a.os_detected ?? a.os_version ?? a.os_type, cell: (a) => (
      <div><div>{a.os_detected ?? a.os_version ?? (a.os_type === "linux" ? "Linux" : "Windows")}</div>{a.privilege && <div className="text-xs text-slate-500">{t("assets.privilege")}: {a.privilege}</div>}</div>
    ) },
    { id: "uptime", header: t("col.uptime"), cell: (a) => <Sparkline assetId={a.id} /> },
    { id: "actions", header: t("col.actions"), locked: true, className: "text-right", cell: (a) => (
      <div className="flex flex-wrap justify-end gap-2">
        {canOperate && (
          <>
            <button onClick={() => connect(a)} disabled={!a.credential_username || opening === a.id} className="inline-flex h-8 items-center rounded bg-cyan-700 px-2 text-xs text-white hover:bg-cyan-600 disabled:opacity-40" title={a.credential_username ? t("assets.connectTip") : t("assets.setCredFirst")}>
              {opening === a.id ? t("assets.opening") : t("common.connect")}
            </button>
            <button onClick={() => setCredFor(a)} className="inline-flex h-8 items-center rounded border border-slate-700 px-2 text-xs hover:bg-slate-800">{t("assets.credential")}</button>
            {canEnroll && !enrolledAssets.has(a.id) && (
              <button onClick={() => setInstallFor(a)} disabled={!a.credential_username} className="inline-flex h-8 items-center rounded border border-slate-700 px-2 text-xs hover:bg-slate-800 disabled:opacity-40" title={a.credential_username ? undefined : t("assets.setCredFirst")}>
                {lang === "az" ? "Agenti qur" : "Install agent"}
              </button>
            )}
            <button onClick={() => setEditing(a)} className="inline-flex h-8 items-center rounded border border-slate-700 px-2 text-xs hover:bg-slate-800">{t("common.edit")}</button>
          </>
        )}
        {isAdmin && (
          <button
            onClick={async () => (await confirm({ title: t("assets.confirmDelete").replace("{name}", a.name), confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true })) && remove.mutate(a.id)}
            className="inline-flex h-8 items-center rounded border border-red-900 px-2 text-xs text-red-400 hover:bg-red-950/50"
          >
            {t("common.delete")}
          </button>
        )}
      </div>
    ) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("assets.title")}</h1>
          <p className="text-sm text-slate-400">
            {t("assets.liveNote")}{" "}
            <span className={connected ? "text-emerald-400" : "text-amber-400"}>
              {connected ? t("assets.liveOn") : t("assets.liveOff")}
            </span>
          </p>
        </div>
      </div>

      <AgentManagement />

      {flash && (
        <div className="flex items-center justify-between rounded-md bg-emerald-950/50 px-4 py-2 text-sm text-emerald-300">
          {flash}
          <button onClick={() => setFlash(null)} className="text-emerald-400 hover:underline">{t("assets.dismiss")}</button>
        </div>
      )}

      {error && <p className="text-red-400">{t("assets.loadError")}: {(error as Error).message}</p>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(a) => a.id}
        storageKey="assets"
        exportName="wearden-hosts"
        loading={isLoading}
        onRowClick={(a) => openDrawer(a.id)}
        filterState={{ value: { q, osFilter, statusFilter }, onChange: (v) => { const f = v as { q: string; osFilter: typeof osFilter; statusFilter: typeof statusFilter }; setQ(f.q ?? ""); setOsFilter(f.osFilter ?? "all"); setStatusFilter(f.statusFilter ?? "all"); } }}
        selection={canOperate ? { selected: picked, onChange: setPicked } : undefined}
        initialSort={{ id: "name", dir: "asc" }}
        emptyTitle={assets.length === 0 ? t("assets.none") : lang === "az" ? "Uyğun host yoxdur" : "No matching hosts"}
        emptyHint={assets.length === 0 ? (lang === "az" ? "Agent qurulduqda və qeydiyyatdan keçdikdə host avtomatik burada görünür." : "A host appears here automatically once an agent is installed and enrolled.") : undefined}
        toolbar={
          <>
            <input type="search" className={`${searchCls} !w-64`} placeholder={lang === "az" ? "Ad, ünvan, OS və ya etiket" : "Search name, address, OS or tag"} value={q} onChange={(e) => setQ(e.target.value)} />
            <Chips label="os" value={osFilter} onChange={setOsFilter} options={[{ id: "all", label: lang === "az" ? "Hamısı" : "All" }, { id: "linux", label: "Linux" }, { id: "windows", label: "Windows" }]} />
            <Chips label="status" value={statusFilter} onChange={setStatusFilter} options={[{ id: "all", label: lang === "az" ? "Hər status" : "Any status" }, { id: "online", label: "Online" }, { id: "offline", label: "Offline" }]} />
            {canOperate && (
              <button onClick={() => setEditing("new")} className="inline-flex h-8 items-center rounded-md border border-slate-700 px-3 text-xs text-slate-200 hover:bg-slate-800">
                {t("assets.add")}
              </button>
            )}
            {canOperate && picked.size > 0 && (
              <button onClick={scanMany} className="inline-flex h-8 items-center rounded-md border border-slate-700 px-3 text-xs text-slate-200 hover:bg-slate-800">
                {lang === "az" ? "Yoxla" : "Scan"} ({picked.size})
              </button>
            )}
            {isAdmin && picked.size > 0 && (
              <button onClick={removeMany} className="inline-flex h-8 items-center rounded-md border border-red-900 px-3 text-xs text-red-400 hover:bg-red-950/50">
                {t("common.delete")} ({picked.size})
              </button>
            )}
          </>
        }
      />

      {openHost !== null && <AssetDrawer assetId={openHost} tab={drawerTab} onTab={(tb) => openDrawer(openHost, tb)} onClose={closeDrawer} />}
      {editing && (
        <AssetModal
          initial={editing === "new" ? null : editing}
          onSave={saveAsset}
          onClose={() => setEditing(null)}
        />
      )}
      {credFor && <CredentialModal asset={credFor} onSave={saveCredential} onClose={() => setCredFor(null)} />}
      {installFor && (
        <RemoteInstallModal
          asset={installFor}
          onClose={() => setInstallFor(null)}
          onInstalled={() => { refresh(); queryClient.invalidateQueries({ queryKey: ["agents"] }); }}
        />
      )}
      {live && (
        <RemoteSession
          session={live}
          onClose={() => setLive(null)}
        />
      )}
    </div>
  );
}
