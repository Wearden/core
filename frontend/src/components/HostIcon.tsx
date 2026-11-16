/** Workstation glyph: a monitor with the operating system mark inside. Pure SVG, follows the text colour. */
export type HostOs = "linux" | "windows" | string;

function Mark({ os }: { os: HostOs }) {
  if (os === "windows") {
    // Four-pane window mark
    return (
      <g fill="currentColor">
        <rect x="8.2" y="6.4" width="3.6" height="3.4" rx=".4" />
        <rect x="12.4" y="6.4" width="3.6" height="3.4" rx=".4" />
        <rect x="8.2" y="10.4" width="3.6" height="3.4" rx=".4" />
        <rect x="12.4" y="10.4" width="3.6" height="3.4" rx=".4" />
      </g>
    );
  }
  if (os === "linux") {
    // Simplified penguin silhouette
    return (
      <g fill="currentColor">
        <path d="M12 5.2c-1.7 0-2.6 1.3-2.6 3 0 .9-.5 1.6-1 2.5-.6 1-.9 2.1-.5 3 .3.6 1 .9 1.6 1h5c.6-.1 1.3-.4 1.6-1 .4-.9.1-2-.5-3-.5-.9-1-1.6-1-2.5 0-1.7-.9-3-2.6-3z" />
        <ellipse cx="12" cy="11.6" rx="1.5" ry="2.2" fill="rgb(var(--slate-950))" />
        <circle cx="11.2" cy="7.9" r=".45" fill="rgb(var(--slate-950))" />
        <circle cx="12.8" cy="7.9" r=".45" fill="rgb(var(--slate-950))" />
      </g>
    );
  }
  return <circle cx="12" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />;
}

export default function HostIcon({ os, size = 36, title }: { os: HostOs; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label={title ?? os} className="shrink-0 text-slate-200">
      <title>{title ?? os}</title>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <Mark os={os} />
      <path d="M9 20.5h6M12 16.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function osLabel(os: HostOs): string {
  return os === "linux" ? "Linux" : os === "windows" ? "Windows" : String(os);
}
