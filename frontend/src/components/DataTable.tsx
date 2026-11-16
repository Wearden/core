import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, tableWrap, theadCls } from "./ui";
import { SkeletonRows } from "./feedback";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Comparator makes the column sortable. */
  sort?: (a: T, b: T) => number;
  /** Plain value for CSV export; columns without it are left out of the export. */
  csv?: (row: T) => string | number | null | undefined;
  /** Hidden until the user turns it on in the Columns menu. */
  defaultHidden?: boolean;
  /** Always shown (cannot be hidden), for example the primary name column. */
  locked?: boolean;
  className?: string;
}

interface Prefs {
  hidden: string[];
  pageSize: number;
}

function loadPrefs(key: string | undefined, columns: Column<never>[], fallbackSize: number): Prefs {
  const base: Prefs = { hidden: columns.filter((c) => c.defaultHidden).map((c) => c.id), pageSize: fallbackSize };
  if (!key) return base;
  try {
    const raw = localStorage.getItem(`wearden.table.${key}`);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((h) => typeof h === "string") : base.hidden, pageSize: typeof parsed.pageSize === "number" ? parsed.pageSize : base.pageSize };
  } catch {
    return base;
  }
}

/** Spreadsheet programs run text that starts with these characters as formulas, so exports neutralize them. */
function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  storageKey,
  onRowClick,
  initialSort,
  pageSizes = [10, 25, 50, 100],
  exportName,
  loading,
  emptyTitle,
  emptyHint,
  toolbar,
  mobileCard,
  rowClassName,
  expanded,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  storageKey?: string;
  onRowClick?: (row: T) => void;
  initialSort?: { id: string; dir: "asc" | "desc" };
  pageSizes?: number[];
  exportName?: string;
  loading?: boolean;
  emptyTitle: string;
  emptyHint?: string;
  toolbar?: ReactNode;
  /** When given, phones show these cards instead of the table. */
  mobileCard?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string;
  /** Detail shown under a row; clicking the row toggles it. */
  expanded?: (row: T) => ReactNode;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(storageKey, columns as Column<never>[], pageSizes[1] ?? pageSizes[0]));
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<Set<string | number>>(new Set());
  const toggle = (k: string | number) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`wearden.table.${storageKey}`, JSON.stringify(prefs));
    } catch {
      /* preferences are a convenience only */
    }
  }, [prefs, storageKey]);

  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [menu]);

  const visible = columns.filter((c) => c.locked || !prefs.hidden.includes(c.id));
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id);
    if (!col?.sort) return rows;
    const copy = [...rows].sort(col.sort);
    return sort!.dir === "desc" ? copy.reverse() : copy;
  }, [rows, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / prefs.pageSize));
  const current = Math.min(page, pages - 1);
  const slice = sorted.slice(current * prefs.pageSize, (current + 1) * prefs.pageSize);

  const toggleSort = (c: Column<T>) => {
    if (!c.sort) return;
    setPage(0);
    setSort((s) => (s?.id === c.id ? (s.dir === "asc" ? { id: c.id, dir: "desc" } : null) : { id: c.id, dir: "asc" }));
  };

  const exportCsv = () => {
    const cols = visible.filter((c) => c.csv);
    const lines = [cols.map((c) => csvCell(c.header)).join(","), ...sorted.map((r) => cols.map((c) => csvCell(c.csv!(r))).join(","))];
    const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const from = sorted.length === 0 ? 0 : current * prefs.pageSize + 1;
  const to = Math.min(sorted.length, (current + 1) * prefs.pageSize);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        <div className="flex items-center gap-2 text-xs">
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenu(!menu)} aria-expanded={menu} className="rounded-md border border-slate-800 px-3 py-1.5 text-slate-300 hover:bg-slate-900">Columns</button>
            {menu && (
              <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
                {columns.filter((c) => !c.locked).map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
                    <input type="checkbox" checked={!prefs.hidden.includes(c.id)} onChange={() => setPrefs((p) => ({ ...p, hidden: p.hidden.includes(c.id) ? p.hidden.filter((h) => h !== c.id) : [...p.hidden, c.id] }))} />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
          {exportName && <button onClick={exportCsv} disabled={sorted.length === 0} className="rounded-md border border-slate-800 px-3 py-1.5 text-slate-300 hover:bg-slate-900 disabled:opacity-40">Export CSV</button>}
        </div>
      </div>

      {loading ? <SkeletonRows /> : sorted.length === 0 ? <EmptyState title={emptyTitle} hint={emptyHint} /> : (
        <>
          {mobileCard && <ul className="space-y-2 md:hidden">{slice.map((r) => <li key={rowKey(r)} onClick={() => onRowClick?.(r)} className={onRowClick ? "cursor-pointer" : ""}>{mobileCard(r)}</li>)}</ul>}
          <div className={`${tableWrap} ${mobileCard ? "hidden md:block" : ""}`}>
            <table className="w-full text-left text-sm">
              <thead className={theadCls}>
                <tr>
                  {visible.map((c) => {
                    const active = sort?.id === c.id;
                    return (
                      <th key={c.id} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined} className={`px-4 py-2.5 font-medium ${c.className ?? ""}`}>
                        {c.sort ? (
                          <button onClick={() => toggleSort(c)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-200">
                            {c.header}
                            <span aria-hidden className={active ? "text-slate-100" : "text-slate-700"}>{active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                          </button>
                        ) : c.header}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {slice.map((r) => {
                  const key = rowKey(r);
                  const click = onRowClick ? () => onRowClick(r) : expanded ? () => toggle(key) : undefined;
                  const isOpen = open.has(key);
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={click ? (e) => !(e.target as HTMLElement).closest("button, a, input, select, summary") && click() : undefined}
                        onKeyDown={click ? (e) => e.key === "Enter" && !(e.target as HTMLElement).closest("button, a, input, select, summary") && click() : undefined}
                        tabIndex={click ? 0 : undefined}
                        aria-expanded={expanded ? isOpen : undefined}
                        className={`hover:bg-slate-900/60 ${click ? "cursor-pointer" : ""} ${rowClassName?.(r) ?? ""}`}
                      >
                        {visible.map((c) => <td key={c.id} className={`px-4 py-2.5 align-top ${c.className ?? ""}`}>{c.cell(r)}</td>)}
                      </tr>
                      {expanded && isOpen && (
                        <tr className="bg-slate-900/40">
                          <td colSpan={visible.length} className="px-4 py-4">{expanded(r)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{from}-{to} / {sorted.length}</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                Rows
                <select value={prefs.pageSize} onChange={(e) => { setPrefs((p) => ({ ...p, pageSize: Number(e.target.value) })); setPage(0); }} className="rounded-md border border-slate-800 bg-slate-950 px-1.5 py-1 text-slate-300">
                  {pageSizes.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button onClick={() => setPage(Math.max(0, current - 1))} disabled={current === 0} aria-label="Previous page" className="rounded-md border border-slate-800 px-2.5 py-1 text-slate-300 hover:bg-slate-900 disabled:opacity-40">Prev</button>
              <span>{current + 1} / {pages}</span>
              <button onClick={() => setPage(Math.min(pages - 1, current + 1))} disabled={current >= pages - 1} aria-label="Next page" className="rounded-md border border-slate-800 px-2.5 py-1 text-slate-300 hover:bg-slate-900 disabled:opacity-40">Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
