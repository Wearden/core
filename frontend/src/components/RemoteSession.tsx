import { ReactNode, useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";
import { sessionsApi } from "../sessionsApi";
import type { SessionOpenResult } from "../sessionTypes";
import { useI18n } from "../i18n";

const STATES = ["idle", "connecting", "waiting", "connected", "disconnecting", "disconnected"] as const;

interface LogLine {
  at: string;
  text: string;
}

interface Props {
  session: SessionOpenResult;
  onClose: () => void;
  /** Replaces the default session log in split view (used by demo mode). */
  sideContent?: ReactNode;
}

/**
 * Embedded SSH/RDP session through guacamole-lite. Split view puts a live event log beside the remote desktop.
 * Phase 6 streams the hardening log into that panel.
 */
export default function RemoteSession({ session, onClose, sideContent }: Props) {
  const { t } = useI18n();
  const screenRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<string>("idle");
  const [split, setSplit] = useState(true);
  const [log, setLog] = useState<LogLine[]>([]);

  const addLog = (text: string) =>
    setLog((lines) => [...lines.slice(-199), { at: new Date().toLocaleTimeString(), text }]);

  useEffect(() => {
    const container = screenRef.current;
    if (!container) return;

    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    // The tunnel reads the encrypted connection token from the query string (guacamole-lite's protocol).
    const tunnel = new Guacamole.WebSocketTunnel(`${scheme}://${window.location.host}/guac/`);
    const client = new Guacamole.Client(tunnel);
    const display = client.getDisplay();
    const element: HTMLElement = display.getElement();
    container.appendChild(element);

    const fit = () => {
      const w = display.getWidth();
      const h = display.getHeight();
      if (!w || !h) return;
      display.scale(Math.min(container.clientWidth / w, container.clientHeight / h, 1));
    };
    display.onresize = fit;
    window.addEventListener("resize", fit);

    client.onstatechange = (code: number) => {
      const name = STATES[code] ?? "unknown";
      setState(name);
      addLog(`state: ${name}`);
    };
    client.onerror = (error: { code: number; message: string }) => {
      addLog(`error ${error.code}: ${error.message}`);
    };

    const mouse = new Guacamole.Mouse(element);
    const sendMouse = (mouseState: unknown) => client.sendMouseState(mouseState);
    mouse.onmousedown = sendMouse;
    mouse.onmouseup = sendMouse;
    mouse.onmousemove = sendMouse;

    const keyboard = new Guacamole.Keyboard(document);
    keyboard.onkeydown = (keysym: number) => client.sendKeyEvent(1, keysym);
    keyboard.onkeyup = (keysym: number) => client.sendKeyEvent(0, keysym);

    addLog(`opening ${session.protocol.toUpperCase()} session to ${session.asset_name}`);
    client.connect(`token=${encodeURIComponent(session.token)}`);

    return () => {
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
      window.removeEventListener("resize", fit);
      client.disconnect();
      container.innerHTML = "";
    };
    // The token is created once per session; re-running this effect would open a second connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const disconnect = async () => {
    try {
      await sessionsApi.end(session.id);
    } finally {
      onClose();
    }
  };

  const connected = state === "connected";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2">
        <div className="flex items-center gap-3 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
          <span className="font-medium">{session.asset_name}</span>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs uppercase">{session.protocol}</span>
          <span className="text-slate-400">{state}</span>
          <span className="text-xs text-red-300">{t("rs.recording")}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setSplit((s) => !s)} className="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800">
            {split ? t("rs.hideLog") : t("rs.splitView")}
          </button>
          <button onClick={disconnect} className="rounded bg-red-700 px-3 py-1 text-sm text-white hover:bg-red-600">
            {t("rs.disconnect")}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={screenRef} className="flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-black" />
        {split && (sideContent ?? (
          <aside className="flex w-80 shrink-0 flex-col border-l border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 px-4 py-2 text-sm font-medium">{t("rs.sessionLog")}</div>
            <ol className="flex-1 space-y-1 overflow-y-auto p-3 font-mono text-xs text-slate-300">
              {log.map((line, i) => (
                <li key={i}>
                  <span className="text-slate-500">{line.at}</span> {line.text}
                </li>
              ))}
            </ol>
          </aside>
        ))}
      </div>
    </div>
  );
}
