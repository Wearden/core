import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { useI18n } from "../i18n";
import HostIcon from "./HostIcon";

export interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  to: string;
  os?: string;
}

/** Jump anywhere: pages and hosts. Opens with Ctrl+K or the search box in the top bar. */
export default function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: PaletteItem[] }) {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list, enabled: open });

  useEffect(() => {
    if (open) {
      setQ("");
      setIndex(0);
      window.setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const hosts = (assets.data ?? []).map((a) => ({ id: `h${a.id}`, label: a.name, hint: lang === "az" ? "Host" : "Host", to: `/assets?host=${a.id}`, os: a.os_type }));
    const needle = q.trim().toLowerCase();
    return [...pages, ...hosts].filter((i) => !needle || `${i.label} ${i.hint}`.toLowerCase().includes(needle)).slice(0, 12);
  }, [assets.data, pages, q, lang]);

  if (!open) return null;
  const go = (item: PaletteItem) => {
    onClose();
    navigate(item.to);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <input
          ref={input}
          value={q}
          onChange={(e) => { setQ(e.target.value); setIndex(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
            if (e.key === "Enter" && items[index]) go(items[index]);
          }}
          placeholder={lang === "az" ? "Səhifə və ya host axtar..." : "Search pages and hosts..."}
          className="w-full border-b border-slate-800 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-slate-500"
        />
        <ul className="max-h-80 overflow-y-auto p-1">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">{lang === "az" ? "Nəticə yoxdur" : "No results"}</li>}
          {items.map((item, i) => (
            <li key={item.id}>
              <button onMouseEnter={() => setIndex(i)} onClick={() => go(item)} className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${i === index ? "bg-slate-800 text-slate-50" : "text-slate-300"}`}>
                {item.os ? <HostIcon os={item.os} size={20} /> : <span aria-hidden className="flex h-5 w-5 items-center justify-center text-slate-500">#</span>}
                <span className="flex-1 truncate">{item.label}</span>
                <span className="text-xs text-slate-500">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
