import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sessionsApi } from "../sessionsApi";
import RecordingPlayer from "../components/RecordingPlayer";
import type { RemoteSessionRow } from "../sessionTypes";
import { useI18n } from "../i18n";

export default function Sessions() {
  const { t } = useI18n();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: sessionsApi.list,
    refetchInterval: 10_000,
  });
  const [playing, setPlaying] = useState<RemoteSessionRow | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("ses.title")}</h1>
        <p className="text-sm text-slate-400">{t("ses.subtitle")}</p>
      </div>
      {error && <p className="text-red-400">{t("ses.loadError")}: {(error as Error).message}</p>}
      {isLoading && <p className="text-slate-400">{t("common.loading")}</p>}
      {!isLoading && data.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-400">
          {t("ses.none")}
        </div>
      )}
      {data.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">{t("col.started")}</th>
                <th className="px-4 py-3">{t("col.name")}</th>
                <th className="px-4 py-3">Protocol</th>
                <th className="px-4 py-3">{t("ses.operator")}</th>
                <th className="px-4 py-3">{t("ses.state")}</th>
                <th className="px-4 py-3 text-right">{t("ses.recording")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.map((s) => (
                <tr key={s.id} className="hover:bg-slate-900/60">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400">{new Date(s.started_at).toLocaleString()}</td>
                  <td className="px-4 py-2">{s.asset_name}</td>
                  <td className="px-4 py-2 uppercase">{s.protocol}</td>
                  <td className="px-4 py-2">{s.operator}</td>
                  <td className="px-4 py-2">{s.ended_at ? t("ses.ended") : t("ses.open")}</td>
                  <td className="px-4 py-2 text-right">
                    {s.has_recording ? (
                      <button
                        onClick={() => setPlaying(s)}
                        className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                      >
                        {t("ses.play")}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">{t("ses.noneYet")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {playing && (
        <RecordingPlayer
          sessionId={playing.id}
          title={`${playing.asset_name} (${playing.protocol.toUpperCase()}, ${new Date(playing.started_at).toLocaleString()})`}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}
