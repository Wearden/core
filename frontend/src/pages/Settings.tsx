import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi, SettingRow } from "../settingsApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

const field = "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";

function Row({ row, vaultReady }: { row: SettingRow; vaultReady: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const done = () => {
    setValue(""); // a secret never stays in browser state after it is sent
    return queryClient.invalidateQueries({ queryKey: ["settings"] });
  };
  const save = useMutation({ mutationFn: () => settingsApi.set(row.key, value.trim()), onSuccess: done });
  const clear = useMutation({ mutationFn: () => settingsApi.clear(row.key), onSuccess: done });
  const error = (save.error ?? clear.error) as Error | null;
  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium">{row.label}</div>
        <span className={`rounded px-2 py-0.5 text-xs ${row.configured ? "bg-emerald-900/50 text-emerald-200" : "bg-slate-800 text-slate-400"}`}>
          {t(`settings.source.${row.source}`)}
        </span>
      </div>
      {!row.secret && row.value && <p className="font-mono text-xs text-slate-400">{row.value}</p>}
      {row.secret && row.configured && <p className="text-xs text-slate-500">{t("settings.secretNote")}</p>}
      <div className="flex gap-2">
        <input
          className={field}
          type={row.secret ? "password" : "text"}
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("settings.placeholder")}
        />
        <button onClick={() => save.mutate()} disabled={!vaultReady || !value.trim() || save.isPending} className="rounded-md bg-cyan-700 px-3 py-2 text-sm hover:bg-cyan-600 disabled:opacity-40">
          {t("common.save")}
        </button>
        {row.source === "database" && (
          <button onClick={() => clear.mutate()} disabled={clear.isPending} className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">
            {t("settings.clear")}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-300">{error.message}</p>}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const { t } = useI18n();
  const isAdmin = user?.role === "admin";
  const { data, error, isLoading } = useQuery({ queryKey: ["settings"], queryFn: settingsApi.list, enabled: isAdmin });
  if (!isAdmin) return <p className="text-slate-400">{t("settings.adminOnly")}</p>;
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("nav.settings")}</h1>
        <p className="text-sm text-slate-400">{t("settings.subtitle")}</p>
      </div>
      {error && <p className="text-red-400">{(error as Error).message}</p>}
      {isLoading && <p className="text-slate-400">{t("common.loading")}</p>}
      {data && !data.vault_ready && <p className="rounded border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">{t("settings.vaultMissing")}</p>}
      {data?.settings.map((row) => <Row key={row.key} row={row} vaultReady={data.vault_ready} />)}
    </div>
  );
}
