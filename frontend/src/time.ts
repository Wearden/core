import { getPrefs } from "./prefs";

/** Every time the app shows is Baku time, whatever the viewer's own computer is set to. The API stays in UTC. */
export const TIME_ZONE = "Asia/Baku";

// 12 or 24 hour clock from the preferences; undefined lets the browser locale decide.
const hour12 = () => {
  const h = getPrefs().hour12;
  return h === "auto" ? undefined : h === "12";
};

type When = string | number | Date;

export const dateTime = (v: When, opts?: Intl.DateTimeFormatOptions) => new Date(v).toLocaleString(undefined, { timeZone: TIME_ZONE, hour12: hour12(), ...opts });
export const dateOnly = (v: When) => new Date(v).toLocaleDateString(undefined, { timeZone: TIME_ZONE });
export const timeOnly = (v: When = Date.now()) => new Date(v).toLocaleTimeString(undefined, { timeZone: TIME_ZONE, hour12: hour12() });

const parts = (v: When) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" })
      .formatToParts(new Date(v))
      .map((p) => [p.type, p.value]),
  );

/** Baku wall time with its offset for CSV cells, e.g. 2026-11-17T11:56:59+04:00. Empty input stays empty. */
export const isoTime = (v: When | null | undefined) => {
  if (v === null || v === undefined || v === "") return "";
  const p = parts(v);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${p.timeZoneName.replace("GMT", "") || "Z"}`;
};

/** File-name-safe Baku time, e.g. 2026-11-17_11-56-59. */
export const fileStamp = (v: When) => {
  const p = parts(v);
  return `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}`;
};
