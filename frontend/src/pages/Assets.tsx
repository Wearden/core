import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useHostsSocket } from "../hooks/useHostsSocket";
import AssetModal from "../components/AssetModal";
import AgentManagement from "../components/AgentManagement";
import CredentialModal from "../components/CredentialModal";
import RemoteSession from "../components/RemoteSession";
import { sessionsApi } from "../sessionsApi";
import type { SessionOpenResult } from "../sessionTypes";
import Sparkline from "../components/Sparkline";
import StatusDot from "../components/StatusDot";
import HostIcon from "../components/HostIcon";
import type { Asset, AssetInput, CredentialInput, TestResult } from "../types";

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
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const { connected } = useHostsSocket();
  const now = useNow();

  const canOperate = user?.role === "admin" || user?.role === "operator";
  const isAdmin = user?.role === "admin";

  const { data: assets = [], isLoading, error } = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list, refetchInterval: 10_000 });

  const [editing, setEditing] = useState<Asset | null | "new">(null);
  const [credFor, setCredFor] = useState<Asset | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult | "running">>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [live, setLive] = useState<SessionOpenResult | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

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

  const runTest = async (asset: Asset) => {
    setTestResults((r) => ({ ...r, [asset.id]: "running" }));
    try {
      const result = await assetsApi.test(asset.id);
      setTestResults((r) => ({ ...r, [asset.id]: result }));
      await refresh();
    } catch (err) {
      setTestResults((r) => ({
        ...r,
        [asset.id]: { ok: false, message: err instanceof Error ? err.message : t("assets.testFailed"), os_detected: null, privilege: null, latency_ms: null },
      }));
    }
  };

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
      {isLoading && <p className="text-slate-400">{t("common.loading")}</p>}

      {!isLoading && assets.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-400">
          {t("assets.none")} {lang === "az" ? "Agent qurulduqda və qeydiyyatdan keçdikdə host avtomatik burada görünür." : "A host appears here automatically once an agent is installed and enrolled."}
        </div>
      )}

      {assets.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">{t("col.status")}</th>
                <th className="px-4 py-3">{t("col.name")}</th>
                <th className="px-4 py-3">Host</th>
                <th className="px-4 py-3">{t("col.os")}</th>
                <th className="px-4 py-3">{t("col.uptime")}</th>
                <th className="px-4 py-3 text-right">{t("col.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {assets.map((a) => {
                const result = testResults[a.id];
                return (
                  <tr key={a.id} className="align-top hover:bg-slate-900/60">
                    <td className="px-4 py-3">
                      <StatusDot status={a.status} />
                      <div className="mt-1 text-xs text-slate-500">{secondsAgo(a.last_checked, now, t("assets.ago"), t("assets.never"))}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <HostIcon os={a.os_type} size={28} />
                        <div>
                          <div className="font-medium text-slate-50">{a.name}</div>
                          {a.tags.length > 0 && <div className="text-xs text-slate-500">{a.tags.join(" · ")}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{a.host}</td>
                    <td className="px-4 py-3">
                      <div>{a.os_detected ?? a.os_version ?? (a.os_type === "linux" ? "Linux" : "Windows")}</div>
                      {a.privilege && <div className="text-xs text-slate-500">{t("assets.privilege")}: {a.privilege}</div>}
                    </td>
                    <td className="px-4 py-3"><Sparkline assetId={a.id} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {canOperate && (
                          <>
                            <button
                              onClick={() => connect(a)}
                              disabled={!a.credential_username || opening === a.id}
                              className="rounded bg-cyan-700 px-2 py-1 text-xs text-white hover:bg-cyan-600 disabled:opacity-40"
                              title={a.credential_username ? t("assets.connectTip") : t("assets.setCredFirst")}
                            >
                              {opening === a.id ? t("assets.opening") : t("common.connect")}
                            </button>
                            <button onClick={() => setCredFor(a)} className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800">
                              {t("assets.credential")}
                            </button>
                            <button onClick={() => setEditing(a)} className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800">
                              {t("common.edit")}
                            </button>
                          </>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => window.confirm(t("assets.confirmDelete").replace("{name}", a.name)) && remove.mutate(a.id)}
                            className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950/50"
                          >
                            {t("common.delete")}
                          </button>
                        )}
                      </div>
                      {result && result !== "running" && (
                        <div className={`mt-2 text-left text-xs ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
                          {result.ok
                            ? `${t("assets.connected")} ${result.os_detected ?? ""} · ${result.privilege ?? ""}`
                            : result.message}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <AssetModal
          initial={editing === "new" ? null : editing}
          onSave={saveAsset}
          onClose={() => setEditing(null)}
        />
      )}
      {credFor && <CredentialModal asset={credFor} onSave={saveCredential} onClose={() => setCredFor(null)} />}
      {live && (
        <RemoteSession
          session={live}
          onClose={() => setLive(null)}
        />
      )}
    </div>
  );
}
