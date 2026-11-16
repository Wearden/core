import { ReactNode, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Theme-aware chart palette read from the CSS variables, refreshed when the theme changes. */
export interface ChartColors {
  fg: string;
  muted: string;
  grid: string;
  line: string;
  soft: string;
  pass: string;
  fail: string;
  error: string;
  panel: string;
}

function readColors(): ChartColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => `rgb(${css.getPropertyValue(name).trim() || "128 128 128"})`;
  return {
    fg: v("--slate-100"),
    muted: v("--slate-500"),
    grid: v("--slate-800"),
    line: v("--slate-200"),
    soft: v("--slate-600"),
    pass: v("--emerald-400"),
    fail: v("--red-400"),
    error: v("--amber-400"),
    panel: v("--slate-900"),
  };
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return colors;
}

export function ChartCard({ title, subtitle, right, className = "", children }: { title: string; subtitle?: string; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900/60 p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-100">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: i.color }} />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

function Tip({ active, payload, label, c }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string; fill?: string; stroke?: string }[]; label?: string; c: ChartColors }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-700 px-3 py-2 text-xs shadow-lg" style={{ background: c.panel, color: c.fg }}>
      {label !== undefined && <div className="mb-1 text-slate-400">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.fill ?? p.stroke }} />
          <span className="text-slate-300">{p.name}</span>
          <span className="ml-auto font-medium">{typeof p.value === "number" ? Math.round(p.value * 10) / 10 : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export interface Series {
  key: string;
  name: string;
  color: string;
}

/** Smooth gradient area chart, one or more series. */
export function TrendArea({ data, xKey, series, height = 240, domain }: { data: Record<string, unknown>[]; xKey: string; series: Series[]; height?: number; domain?: [number, number] }) {
  const c = useChartColors();
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="3 4" />
          <XAxis dataKey={xKey} stroke={c.muted} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={c.muted} fontSize={11} tickLine={false} axisLine={false} domain={domain} />
          <Tooltip content={<Tip c={c} />} cursor={{ stroke: c.soft, strokeDasharray: "3 3" }} />
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} fill={`url(#g-${s.key})`} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Rounded (optionally stacked) bars; horizontal layout lists categories on the Y axis. */
export function Bars({ data, xKey, series, height = 240, horizontal = false, stacked = false, yWidth = 110 }: { data: Record<string, unknown>[]; xKey: string; series: Series[]; height?: number; horizontal?: boolean; stacked?: boolean; yWidth?: number }) {
  const c = useChartColors();
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 6, right: 8, left: horizontal ? 0 : -18, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid horizontal={!horizontal} vertical={horizontal} stroke={c.grid} strokeDasharray="3 4" />
          {horizontal ? (
            <>
              <XAxis type="number" stroke={c.muted} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey={xKey} stroke={c.muted} fontSize={11} tickLine={false} axisLine={false} width={yWidth} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} stroke={c.muted} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke={c.muted} fontSize={11} tickLine={false} axisLine={false} />
            </>
          )}
          <Tooltip content={<Tip c={c} />} cursor={{ fill: c.grid, opacity: 0.4 }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? "a" : undefined} radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]} maxBarSize={horizontal ? 20 : 36} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut with a centre figure, for ratios and KPIs. */
export function Ring({ data, centerValue, centerLabel, height = 200 }: { data: { name: string; value: number; color: string }[]; centerValue: string; centerLabel: string; height?: number }) {
  const c = useChartColors();
  const shown = data.filter((d) => d.value > 0);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={shown.length ? shown : [{ name: "none", value: 1, color: c.grid }]} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="92%" paddingAngle={shown.length > 1 ? 3 : 0} stroke="none" cornerRadius={4} isAnimationActive={false}>
            {(shown.length ? shown : [{ name: "none", value: 1, color: c.grid }]).map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip content={<Tip c={c} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-semibold text-slate-50">{centerValue}</div>
        <div className="text-xs text-slate-500">{centerLabel}</div>
      </div>
    </div>
  );
}

/** Multi-axis radar, values 0 to 100. */
export function RadarScores({ data, name, height = 260 }: { data: { axis: string; value: number }[]; name: string; height?: number }) {
  const c = useChartColors();
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="58%">
          <PolarGrid stroke={c.grid} />
          <PolarAngleAxis dataKey="axis" tick={{ fill: c.muted, fontSize: 10 }} />
          <Tooltip content={<Tip c={c} />} />
          <Radar name={name} dataKey="value" stroke={c.line} fill={c.line} fillOpacity={0.18} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tiny area line for KPI cards. */
export function Spark({ values, color }: { values: number[]; color?: string }) {
  const c = useChartColors();
  const stroke = color ?? c.line;
  if (values.length < 2) return <div className="h-10" />;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.6} fill="url(#spark)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Hosts by categories grid; each cell is a compliance score from red to green. */
export function HeatGrid({ categories, rows }: { categories: string[]; rows: { name: string; cells: Record<string, number | null> }[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="grid gap-1 text-[11px]" style={{ gridTemplateColumns: `minmax(110px,160px) repeat(${categories.length}, minmax(44px,1fr))` }}>
        <div />
        {categories.map((cat) => (
          <div key={cat} className="truncate px-1 pb-1 text-center text-slate-500" title={cat}>{cat}</div>
        ))}
        {rows.map((r) => (
          <div key={r.name} className="contents">
            <div className="truncate py-1.5 pr-2 text-slate-300" title={r.name}>{r.name}</div>
            {categories.map((cat) => {
              const v = r.cells[cat] ?? null;
              return (
                <div
                  key={cat}
                  title={v === null ? "no data" : `${v.toFixed(0)}%`}
                  className="rounded-md py-1.5 text-center font-medium"
                  style={{ background: v === null ? "rgb(var(--slate-800))" : `color-mix(in srgb, rgb(var(--emerald-400)) ${Math.round(v)}%, rgb(var(--red-400)))`, color: v === null ? "rgb(var(--slate-500))" : "rgb(var(--heat-ink))" }}
                >
                  {v === null ? "-" : Math.round(v)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
