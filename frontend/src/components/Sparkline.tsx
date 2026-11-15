import { useQuery } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";

const W = 120;
const H = 26;

const LEVEL: Record<string, number> = { online: 3, degraded: 2, offline: 1 };

/** Uptime sparkline: higher line = more management ports reachable. Refreshes every 10 s. */
export default function Sparkline({ assetId }: { assetId: number }) {
  const { data } = useQuery({
    queryKey: ["history", assetId],
    queryFn: () => assetsApi.history(assetId, 60),
    refetchInterval: 10_000,
  });

  if (!data || data.length === 0) return <span className="text-xs text-slate-500">no history</span>;

  const points = data
    .map((s, i) => {
      const x = data.length === 1 ? W : (i / (data.length - 1)) * W;
      const y = H - 4 - ((LEVEL[s.status] ?? 0) / 3) * (H - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="uptime history">
      <polyline fill="none" stroke="#22d3ee" strokeWidth={1.5} points={points} />
    </svg>
  );
}
