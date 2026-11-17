import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, tableWrap, theadCls } from "./ui";
import { SkeletonRows } from "./feedback";
import { useI18n } from "../i18n";

// Empty cells show a quiet dash instead of a gap.
const blank = (v: ReactNode) => v === null || v === undefined || v === "" || v === false;

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
  /** Takes the spare width and wraps. Without one, the first visible column does; every other column hugs its content. */
  wide?: boolean;
  /** Long values that may wrap, kept to a readable width (evidence, details). */
  wrap?: boolean;
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

interface View {
  name: string;
  hidden: string[];
  pageSize: number;
  sort: { id: string; dir: "asc" | "desc" } | null;
  filters?: unknown;
}

function loadViews(key: string | undefined): View[] {
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(`wearden.views.${key}`) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.name === "string" && Array.isArray(v.hidden) && typeof v.pageSize === "number") : [];
  } catch {
    return [];
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
  selection,
  filterState,
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
  /** Adds a checkbox column. Selection is owned by the page so bulk actions can use it. */
  /** Page filters (search, chips) that saved views should remember. */
  filterState?: { value: unknown; onChange: (v: unknown) => void };
  selection?: { selected: Set<string | number>; onChange: (next: Set<string | number>) => void };
}) {
  const { lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(storageKey, columns as Column<never>[], pageSizes[1] ?? pageSizes[0]));
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<Set<string | number>>(new Set());
  const toggle = (k: string | number) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const menuRef = useRef<HTMLDivElement>(null);
  const [views, setViews] = useState<View[]>(() => loadViews(storageKey));
  const [viewMenu, setViewMenu] = useState(false);
  const [viewName, setViewName] = useState("");
  const viewRef = useRef<HTMLDivElement>(null);
  const persistViews = (next: View[]) => {
    setViews(next);
    try { localStorage.setItem(`wearden.views.${storageKey}`, JSON.stringify(next)); } catch { /* convenience only */ }
  };
  const saveView = () => {
    const name = viewName.trim().slice(0, 40);
    if (!name) return;
    persistViews([...views.filter((v) => v.name !== name), { name, hidden: prefs.hidden, pageSize: prefs.pageSize, sort, filters: filterState?.value }]);
    setViewName("");
  };
  const applyView = (v: View) => {
    setPrefs({ hidden: v.hidden.filter((h) => columns.some((c) => c.id === h && !c.locked)), pageSize: v.pageSize });
    setSort(v.sort && columns.some((c) => c.id === v.sort!.id) ? v.sort : null);
    if (v.filters !== undefined) filterState?.onChange(v.filters);
    setPage(0);
    setViewMenu(false);
  };
  useEffect(() => {
    if (!viewMenu) return;
    const down = (e: MouseEvent) => viewRef.current && !viewRef.current.contains(e.target as Node) && setViewMenu(false);
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [viewMenu]);

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
  const wideId = (visible.find((c) => c.wide) ?? visible.find((c) => c.header) ?? visible[0])?.id;
  const layout = (c: Column<T>) => (c.id === wideId ? "w-full min-w-[14rem]" : c.wrap ? "min-w-[10rem] max-w-[26rem] break-words" : "whitespace-nowrap");
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

  const exportCsv = (onlySelected = false) => {
    const cols = visible.filter((c) => c.csv);
    const source = onlySelected && selection ? sorted.filter((r) => selection.selected.has(rowKey(r))) : sorted;
    const lines = [cols.map((c) => csvCell(c.header)).join(","), ...source.map((r) => cols.map((c) => csvCell(c.csv!(r))).join(","))];
    const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? "export"}${onlySelected ? "-selected" : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pageKeys = slice.map(rowKey);
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => selection?.selected.has(k));
  const setPageSelected = (on: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    pageKeys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    selection.onChange(next);
  };
  const toggleOne = (k: string | number) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    next.has(k) ? next.delete(k) : next.add(k);
    selection.onChange(next);
  };
  const colSpan = visible.length + (selection ? 1 : 0);

  const from = sorted.length === 0 ? 0 : current * prefs.pageSize + 1;
  const to = Math.min(sorted.length, (current + 1) * prefs.pageSize);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {storageKey && (
            <div className="relative" ref={viewRef}>
              <button onClick={() => setViewMenu(!viewMenu)} aria-expanded={viewMenu} className="inline-flex h-8 items-center rounded-md border border-slate-800 px-3 text-slate-300 hover:bg-slate-900">{L("Views", "Görünüşlər")}{views.length ? ` (${views.length})` : ""}</button>
              {viewMenu && (
                <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
                  {views.length === 0 && <p className="px-2 py-1.5 text-xs text-slate-500">{L("No saved views yet. Arrange sort, columns and page size, then save them under a name.", "Hələ saxlanmış görünüş yoxdur. Sıralama, sütunlar və sətir sayını qurub bir adla saxlayın.")}</p>}
                  {views.map((v) => (
                    <div key={v.name} className="flex items-center justify-between gap-1 rounded px-2 py-1 hover:bg-slate-800">
                      <button onClick={() => applyView(v)} className="flex-1 truncate text-left text-sm text-slate-200" title={v.name}>{v.name}</button>
                      <button onClick={() => persistViews(views.filter((x) => x.name !== v.name))} aria-label={`Delete view ${v.name}`} className="text-xs text-red-400 hover:underline">x</button>
                    </div>
                  ))}
                  <div className="mt-1 flex gap-1 border-t border-slate-800 pt-2">
                    <input value={viewName} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveView()} placeholder={L("View name", "Görünüş adı")} aria-label={L("View name", "Görünüş adı")} className="h-8 min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm" />
                    <button onClick={saveView} disabled={!viewName.trim()} className="inline-flex h-8 items-center rounded-md border border-slate-700 px-2 text-slate-200 hover:bg-slate-800 disabled:opacity-40">{L("Save", "Saxla")}</button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenu(!menu)} aria-expanded={menu} className="inline-flex h-8 items-center rounded-md border border-slate-800 px-3 text-slate-300 hover:bg-slate-900">{L("Columns", "Sütunlar")}</button>
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
          {exportName && selection && selection.selected.size > 0 && <button onClick={() => exportCsv(true)} className="inline-flex h-8 items-center rounded-md border border-slate-800 px-3 text-slate-300 hover:bg-slate-900">{L("Export selected", "Seçilənləri ixrac et")} ({selection.selected.size})</button>}
          {exportName && <button onClick={() => exportCsv()} disabled={sorted.length === 0} className="inline-flex h-8 items-center rounded-md border border-slate-800 px-3 text-slate-300 hover:bg-slate-900 disabled:opacity-40">{L("Export CSV", "CSV ixrac")}</button>}
        </div>
      </div>

      {loading ? <SkeletonRows /> : sorted.length === 0 ? <EmptyState title={emptyTitle} hint={emptyHint} /> : (
        <>
          {mobileCard && <ul className="space-y-2 md:hidden">{slice.map((r) => <li key={rowKey(r)} onClick={() => onRowClick?.(r)} className={onRowClick ? "cursor-pointer" : ""}>{mobileCard(r)}</li>)}</ul>}
          <div className={`${tableWrap} ${mobileCard ? "hidden md:block" : ""}`}>
            <table className="w-full text-left text-sm">
              <thead className={theadCls}>
                <tr>
                  {selection && (
                    <th scope="col" className="w-10 px-4 py-2.5">
                      <input type="checkbox" aria-label="Select page" checked={allOnPage} onChange={(e) => setPageSelected(e.target.checked)} />
                    </th>
                  )}
                  {visible.map((c) => {
                    const active = sort?.id === c.id;
                    return (
                      <th key={c.id} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined} className={`px-4 py-3 font-semibold ${layout(c)} ${c.className ?? ""}`}>
                        {c.sort ? (
                          <button onClick={() => toggleSort(c)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-200">
                            {c.header}
                            <span aria-hidden className={active ? "text-slate-100" : "text-slate-500"}>{active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                          </button>
                        ) : c.header}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 tabular-nums">
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
                        className={`transition-colors even:bg-slate-900/30 hover:bg-slate-800/50 ${click ? "cursor-pointer" : ""} ${isOpen ? "bg-slate-800/40" : ""} ${rowClassName?.(r) ?? ""}`}
                      >
                        {selection && <td className="w-10 px-4 py-2.5 align-middle"><input type="checkbox" aria-label="Select row" checked={selection.selected.has(key)} onChange={() => toggleOne(key)} /></td>}
                        {visible.map((c) => {
                          const v = c.cell(r);
                          return <td key={c.id} className={`px-4 py-2.5 align-middle text-slate-200 ${layout(c)} ${c.className ?? ""}`}>{blank(v) ? <span className="text-slate-600">-</span> : v}</td>;
                        })}
                      </tr>
                      {expanded && isOpen && (
                        <tr className="bg-slate-900/40">
                          <td colSpan={colSpan} className="px-4 py-4">{expanded(r)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {L(`Showing ${from}-${to} of ${sorted.length}`, `${sorted.length} nəticədən ${from}-${to}`)}
              {selection && selection.selected.size > 0 && <span className="ml-2 text-slate-300">{selection.selected.size} {L("selected", "seçilib")}</span>}
              {selection && sorted.length > pageKeys.length && (
                <button onClick={() => selection.onChange(new Set(sorted.map(rowKey)))} className="ml-2 underline hover:text-slate-200">{L(`Select all ${sorted.length}`, `Hamısını seç (${sorted.length})`)}</button>
              )}
            </span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                {L("Rows", "Sətir")}
                <select value={prefs.pageSize} onChange={(e) => { setPrefs((p) => ({ ...p, pageSize: Number(e.target.value) })); setPage(0); }} className="h-8 rounded-md border border-slate-800 bg-slate-950 px-1.5 text-slate-300">
                  {pageSizes.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button onClick={() => setPage(Math.max(0, current - 1))} disabled={current === 0} aria-label="Previous page" className="inline-flex h-8 items-center rounded-md border border-slate-800 px-2.5 text-slate-300 hover:bg-slate-900 disabled:opacity-40">Prev</button>
              <span>{current + 1} / {pages}</span>
              <button onClick={() => setPage(Math.min(pages - 1, current + 1))} disabled={current >= pages - 1} aria-label="Next page" className="inline-flex h-8 items-center rounded-md border border-slate-800 px-2.5 text-slate-300 hover:bg-slate-900 disabled:opacity-40">Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
