// Per-browser appearance preferences (theme and table density). Storage can be unavailable, so every access is guarded.
export type ThemePref = "dark" | "light" | "system";
export type Density = "comfortable" | "compact";
/** on: always animate, system: follow the operating system "reduce motion" setting, off: no animation. */
export type Motion = "on" | "system" | "off";

const THEME_KEY = "wearden.theme";
const DENSITY_KEY = "wearden.density";
const MOTION_KEY = "wearden.motion";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* keep the in-memory choice only */
  }
}

export function getThemePref(): ThemePref {
  const v = read(THEME_KEY);
  return v === "light" || v === "system" ? v : "dark";
}

export function resolvedTheme(pref: ThemePref = getThemePref()): "dark" | "light" {
  if (pref === "system") return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  return pref;
}

export function getDensity(): Density {
  return read(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
}

export function getMotion(): Motion {
  const v = read(MOTION_KEY);
  return v === "system" || v === "off" ? v : "on";
}

export function applyAppearance() {
  document.documentElement.dataset.motion = getMotion();
  document.documentElement.dataset.theme = resolvedTheme();
  document.documentElement.dataset.density = getDensity();
}

export function setThemePref(pref: ThemePref) {
  write(THEME_KEY, pref);
  applyAppearance();
  window.dispatchEvent(new Event("wearden-appearance"));
}

export function setDensity(d: Density) {
  write(DENSITY_KEY, d);
  applyAppearance();
  window.dispatchEvent(new Event("wearden-appearance"));
}

export function setMotion(m: Motion) {
  write(MOTION_KEY, m);
  applyAppearance();
  window.dispatchEvent(new Event("wearden-appearance"));
}
