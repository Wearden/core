import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sessionsApi } from "../sessionsApi";
import RecordingPlayer from "../components/RecordingPlayer";
import type { RemoteSessionRow } from "../sessionTypes";
import { useI18n } from "../i18n";
import { EmptyState, PageHeader } from "../components/ui";
import { download } from "../analyticsApi";
import { dateTime, fileStamp } from "../time";

/** Asset, protocol and Baku start time, e.g. web01-ssh-2026-11-17_10-10-15. Also the download file name, so no characters a file system rejects. */
const recordingName = (s: RemoteSessionRow) =>
  `${s.asset_name}-${s.protocol}-${fileStamp(s.started_at)}`.replace(/[\\/:*?"<>|\s]+/g, "-");

export default function Sessions() {
  const { t, lang } = useI18n();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: sessionsApi.list,
    refetchInterval: 10_000,
  });
  const [playing, setPlaying] = useState<RemoteSessionRow | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // The server converts to MP4 on request, which takes a few seconds per minute of recording.
  const [preparing, setPreparing] = useState<string | null>(null);
  const save = (s: RemoteSessionRow) => {
    setDownloadError(null);
    setPreparing(s.id);
    download(`/sessions/${s.id}/recording?format=mp4`, `${recordingName(s)}.mp4`)
      .catch((err) => setDownloadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPreparing(null));
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("ses.title")} subtitle={t("ses.subtitle")} />
      {error && <p className="text-red-400">{t("ses.loadError")}: {(error as Error).message}</p>}
      {downloadError && <p role="alert" className="text-red-400">{t("ses.downloadFail")}: {downloadError}</p>}
      {isLoading && <p className="text-slate-400">{t("common.loading")}</p>}
      {!isLoading && data.length === 0 && (
        <EmptyState
          title={t("ses.none")}
          hint={lang === "az" ? "Sessiyalar yalnız uzaq qoşulma konfiqurasiya olunanda və Aktivlər səhifəsindən Connect basılanda görünür." : "Sessions appear here after you use Connect on the Assets page, which needs remote access configured."}
        />
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
                <th className="px-4 py-3">{t("ses.name")}</th>
                <th className="px-4 py-3 text-right">{t("ses.recording")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.map((s) => (
                <tr key={s.id} className="hover:bg-slate-900/60">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400">{dateTime(s.started_at)}</td>
                  <td className="px-4 py-2">{s.asset_name}</td>
                  <td className="px-4 py-2 uppercase">{s.protocol}</td>
                  <td className="px-4 py-2">{s.operator}</td>
                  <td className="px-4 py-2">{s.ended_at ? t("ses.ended") : t("ses.open")}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-300">{s.has_recording ? recordingName(s) : ""}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {s.has_recording ? (
                      <>
                        <button
                          onClick={() => setPlaying(s)}
                          className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                        >
                          {t("ses.play")}
                        </button>
                        <button
                          onClick={() => save(s)}
                          disabled={preparing === s.id}
                          className="ml-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-50"
                        >
                          {preparing === s.id ? t("ses.preparing") : t("ses.download")}
                        </button>
                      </>
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
          title={recordingName(playing)}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}
