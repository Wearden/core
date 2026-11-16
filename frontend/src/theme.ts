// Per-browser appearance preferences (theme and table density). Storage can be unavailable, so every access is guarded.
export type ThemePref = "dark" | "light" | "system";
export type Density = "comfortable" | "compact";

const THEME_KEY = "wearden.theme";
const DENSITY_KEY = "wearden.density";

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

export function applyAppearance() {
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
