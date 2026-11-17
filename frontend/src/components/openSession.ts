import { sessionsApi } from "../sessionsApi";
import type { SessionOpenResult } from "../sessionTypes";
import type { Asset } from "../types";
import type { useFeedback } from "./feedback";

type Confirm = ReturnType<typeof useFeedback>["confirm"];

/**
 * Opens a recorded SSH or RDP session to an asset. Windows hosts first need their RDP certificate confirmed.
 * Returns null when the operator declines the certificate.
 */
export async function openSession(asset: Asset, confirm: Confirm, az: boolean, cancelLabel: string): Promise<SessionOpenResult | null> {
  const L = (en: string, a: string) => (az ? a : en);
  let fingerprint = "";
  if (asset.os_type === "windows") {
    const cert = await sessionsApi.rdpCertificate(asset.id);
    if (!cert.trusted) {
      const ok = await confirm({
        title: cert.changed ? L("RDP certificate changed", "RDP sertifikatı dəyişib") : L("Confirm the RDP certificate", "RDP sertifikatını təsdiqləyin"),
        message: `${cert.changed ? L("This host's certificate differs from the one confirmed earlier. Continue only if the host was reinstalled or its certificate renewed. ", "Bu hostun sertifikatı əvvəl təsdiqlənəndən fərqlidir. Yalnız host yenidən qurulubsa və ya sertifikat yenilənibsə davam edin. ") : ""}${L("Compare the fingerprint with the one on the host", "Barmaq izini hostdakı ilə müqayisə edin")}: ${cert.fingerprint} (${cert.subject})`,
        confirmLabel: L("Trust and connect", "Etibar et və qoşul"),
        cancelLabel,
        danger: cert.changed,
      });
      if (!ok) return null;
      fingerprint = cert.fingerprint;
    }
  }
  return sessionsApi.open(asset.id, Math.max(640, window.innerWidth - 340), Math.max(480, window.innerHeight - 60), fingerprint);
}
