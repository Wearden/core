import { useI18n } from "../i18n";

/** True when every word of the query appears in at least one of the given texts. Case is ignored. */
export function matchesSearch(query: string, texts: (string | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** Search field for a list page, with a clear button and a "shown of total" count while a search is active. */
export default function SearchBox({
  value,
  onChange,
  placeholder,
  shown,
  total,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  shown: number;
  total: number;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full max-w-md">
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 pr-16 text-sm outline-none focus:border-cyan-500"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            {t("common.clear")}
          </button>
        )}
      </div>
      {value.trim() && (
        <span className="text-xs text-slate-400">
          {shown} {t("scan.of")} {total} {t("search.shown")}
        </span>
      )}
    </div>
  );
}
