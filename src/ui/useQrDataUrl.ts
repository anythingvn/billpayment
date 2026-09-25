import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';

export const qrToDataUrl = (payload: string): Promise<string> =>
  QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 360 });

export function useQrDataUrl(payload: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!payload) {
      setUrl(null);
      return;
    }
    qrToDataUrl(payload)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
    };
  }, [payload]);
  return url;
}
