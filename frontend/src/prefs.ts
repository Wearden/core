import { useEffect, useState } from "react";

/** Personal preferences kept in this browser, like the theme. */
export interface Prefs {
  hour12: "auto" | "24" | "12";
  startPage: string;
  assistant: boolean;
  liveAutoOpen: boolean;
}

export const START_PAGES = ["/", "/assets", "/scans", "/hardening", "/reports"];
const KEY = "wearden.prefs";
const DEFAULTS: Prefs = { hour12: "auto", startPage: "/", assistant: true, liveAutoOpen: true };
// Choices made this session, so they still apply when browser storage is blocked.
let session: Partial<Prefs> = {};

export function getPrefs(): Prefs {
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    /* storage blocked or corrupt: use defaults */
  }
  const p = { ...DEFAULTS, ...stored, ...session };
  if (!START_PAGES.includes(p.startPage)) p.startPage = "/";
  return p;
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  session = { ...session, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getPrefs(), [key]: value }));
  } catch {
    /* storage blocked: the choice lasts until the page is reloaded */
  }
  window.dispatchEvent(new Event(KEY));
}

/** Current preferences; re-renders when any of them changes. */
export function usePrefs(): Prefs {
  const [prefs, setPrefs] = useState(getPrefs);
  useEffect(() => {
    const on = () => setPrefs(getPrefs());
    window.addEventListener(KEY, on);
    return () => window.removeEventListener(KEY, on);
  }, []);
  return prefs;
}
