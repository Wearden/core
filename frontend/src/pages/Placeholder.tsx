import { useI18n } from "../i18n";

export default function Placeholder({ title, phase }: { title: string; phase: number }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center">
      <h1 className="text-2xl font-bold">{t(title)}</h1>
      <p className="mt-2 text-slate-400">{t("placeholder.phase").replace("{phase}", String(phase))}</p>
    </div>
  );
}
