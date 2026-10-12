import { useEffect, useState } from 'react';
import { objectURL, releaseURL } from './lib';
import type { QRFrame } from './qr-format';

export function useFormattedQR(blob: Blob | null) {
  const [result, setResult] = useState<{ source: Blob; url: string; blob: Blob } | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    setResult(null);
    setChecking(!!blob);
    if (!blob) return;
    let cancelled = false, url = '';
    let worker: Worker | undefined;
    const timeout = window.setTimeout(() => { worker?.terminate(); if (!cancelled) setChecking(false); cancelled = true; }, 20_000);
    void (async () => {
      const bitmap = await createImageBitmap(blob);
      try {
        if (cancelled) return;
        // Bound browser memory and worker cost for large bank screenshots.
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas unavailable');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        worker = new Worker(new URL('./qr-format.worker.ts', import.meta.url), { type: 'module' });
        worker.onerror = () => { worker?.terminate(); clearTimeout(timeout); if (!cancelled) setChecking(false); };
        worker.onmessage = async (event: MessageEvent<QRFrame | null>) => {
          worker?.terminate(); clearTimeout(timeout);
          if (cancelled) return;
          try {
            if (event.data) {
              const { pixels, width, height } = event.data;
              canvas.width = width; canvas.height = height;
              const image = context.createImageData(width, height); image.data.set(pixels);
              context.putImageData(image, 0, 0);
              const cropped = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
              if (cropped && !cancelled) { url = objectURL(cropped); setResult({ source: blob, url, blob: cropped }); }
            }
          } catch {
            // Keep the original if PNG encoding or canvas access fails.
          } finally { if (!cancelled) setChecking(false); }
        };
        worker.postMessage({ pixels: frame.data, width: frame.width, height: frame.height }, [frame.data.buffer]);
      } finally { bitmap.close(); }
    })().catch(() => { clearTimeout(timeout); worker?.terminate(); if (!cancelled) setChecking(false); });
    return () => { cancelled = true; clearTimeout(timeout); worker?.terminate(); if (url) releaseURL(url); };
  }, [blob]);
  return { formatted: result?.source === blob ? result : null, checking };
}
