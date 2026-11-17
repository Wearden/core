import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";
import { fetchBlobUrl } from "../api";
import { useI18n } from "../i18n";

interface Props {
  sessionId: string;
  title: string;
  onClose: () => void;
}

/** Plays a guacd recording (.guac) in the browser. Playback is read-only and does not touch the target. */
export default function RecordingPlayer({ sessionId, title, onClose }: Props) {
  const { t, lang } = useI18n();
  const screenRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<{ at: number; total: number }>({ at: 0, total: 0 });
  const recordingRef = useRef<any>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const fitRef = useRef<() => void>(() => undefined);
  // True until the viewer pauses: the library ignores play() while no frames are loaded and pauses by itself when playback outruns loading.
  const wantPlay = useRef(true);

  // Real browser full screen. It is requested right after Play was clicked, which the browser still counts as the user's gesture.
  useEffect(() => {
    rootRef.current?.requestFullscreen?.().catch(() => { /* refused: the overlay still fills the window */ });
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : rootRef.current?.requestFullscreen?.())?.catch?.(() => undefined);

  useEffect(() => {
    let blobUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        blobUrl = await fetchBlobUrl(`/sessions/${sessionId}/recording`);
        if (cancelled || !screenRef.current) return;
        // SessionRecording takes a Blob or a tunnel, not a URL; its Blob path is broken in 1.5.0, so stream the file through a tunnel.
        const recording = new Guacamole.SessionRecording(new Guacamole.StaticHTTPTunnel(blobUrl));
        recordingRef.current = recording;
        screenRef.current.appendChild(recording.getDisplay().getElement());
        const tryPlay = () => { if (wantPlay.current && !recording.isPlaying()) recording.play(); };
        recording.onprogress = (at: number, total: number) => { setProgress({ at, total }); tryPlay(); };
        recording.onload = tryPlay;
        recording.onplay = () => setPlaying(true);
        recording.onpause = () => setPlaying(false);
        // Keep the picture fitted to the window, whatever the recorded screen size is.
        const fit = () => {
          const box = screenRef.current;
          const w = recording.getDisplay().getWidth();
          const h = recording.getDisplay().getHeight();
          if (box && w && h) recording.getDisplay().scale(Math.min(box.clientWidth / w, box.clientHeight / h));
        };
        recording.getDisplay().onresize = fit;
        window.addEventListener("resize", fit);
        fitRef.current = fit;
        recording.connect();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("rec.loadFail"));
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("resize", fitRef.current);
      recordingRef.current?.pause?.();
      recordingRef.current = null;
      if (screenRef.current) screenRef.current.innerHTML = "";
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [sessionId]);

  const toggle = () => {
    const rec = recordingRef.current;
    if (!rec) return;
    if (playing) { wantPlay.current = false; rec.pause(); }
    else { wantPlay.current = true; rec.play(); }
  };

  const seconds = (ms: number) => `${Math.floor(ms / 1000)} s`;

  return (
    <div ref={rootRef} className="fixed inset-0 z-50 flex flex-col bg-slate-950" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2">
        <div className="text-sm">
          <span className="font-medium">{t("rec.recording")} {title}</span>
          <span className="ml-3 text-slate-400">
            {seconds(progress.at)} / {seconds(progress.total)}
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={toggle} disabled={!!error} className="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-40">
            {playing ? t("rec.pause") : t("ses.play")}
          </button>
          <button onClick={toggleFull} className="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800">{full ? (lang === "az" ? "Tam ekrandan çıx" : "Exit full screen") : lang === "az" ? "Tam ekran" : "Full screen"}</button>
          <button onClick={onClose} className="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800">
            {t("rec.close")}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="p-4 text-red-300">{error}</p>}
      <div ref={screenRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black" />
    </div>
  );
}
