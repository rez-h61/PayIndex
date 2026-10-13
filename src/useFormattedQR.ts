import { useEffect, useState } from 'react';
import { objectURL, releaseURL } from './lib';
import type { CleanQRFrame, QRFrame } from './qr-format';
import { DEFAULT_QR_STYLE, type QRStyle } from './qr-style';

type Formatted = { url: string; pngURL: string; blob: Blob; svg: Blob; fallback: boolean };
type State = { source: Blob; key: string; formatted: Formatted | null; checking: boolean };

export function useFormattedQR(blob: Blob | null, style: QRStyle | null = null, allowFallback = true) {
  const key = JSON.stringify(style ?? DEFAULT_QR_STYLE);
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    if (!blob) return;
    let cancelled = false, worker: Worker | undefined, frame: QRFrame;
    let pending: { svg: Blob; url: string; png: Blob } | null = null;
    let fallback = false;
    const urls: string[] = [];
    const urlFor = (value: Blob) => { const url=objectURL(value); urls.push(url); return url; };
    const finish = (formatted: Formatted | null) => {
      clearTimeout(timeout); worker?.terminate();
      if (!cancelled) setState({ source: blob, key, formatted, checking: false });
    };
    const retryOrFinish = () => {
      if (allowFallback && !fallback && key !== JSON.stringify(DEFAULT_QR_STYLE)) {
        fallback = true; pending = null;
        worker?.postMessage({ type: 'generate', frame, style: DEFAULT_QR_STYLE });
      } else finish(null);
    };
    const timeout = window.setTimeout(() => { finish(null); cancelled = true; }, 20_000);
    setState({ source: blob, key, formatted: null, checking: true });
    void (async () => {
      const bitmap = await createImageBitmap(blob);
      try {
        if (cancelled) return;
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas unavailable');
        context.fillStyle='#fff'; context.fillRect(0,0,canvas.width,canvas.height);
        context.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const original = context.getImageData(0,0,canvas.width,canvas.height);
        frame = { pixels: original.data, width: original.width, height: original.height };
        worker = new Worker(new URL('./qr-format.worker.ts',import.meta.url), {type:'module'});
        worker.onerror = () => finish(null);
        worker.onmessage = async (event: MessageEvent<{type:'generated';result:Pick<CleanQRFrame,'svg'|'width'|'height'>|null}|{type:'verified';valid:boolean}>) => {
          if (cancelled) return;
          try {
            if (event.data.type === 'verified') {
              if (event.data.valid && pending) {
                finish({ url: pending.url, pngURL: urlFor(pending.png), blob: pending.png, svg: pending.svg, fallback });
              } else retryOrFinish();
              return;
            }
            if (!event.data.result) { retryOrFinish(); return; }
            const generated=event.data.result;
            const svg=new Blob([generated.svg],{type:'image/svg+xml'}), url=urlFor(svg);
            const image=new Image(); image.src=url; await image.decode();
            if(cancelled)return;
            canvas.width=generated.width; canvas.height=generated.height;
            context.fillStyle='#fff'; context.fillRect(0,0,canvas.width,canvas.height);
            context.drawImage(image,0,0,canvas.width,canvas.height);
            const rendered=context.getImageData(0,0,canvas.width,canvas.height);
            const png=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
            if(cancelled)return;
            if(!png){retryOrFinish();return;}
            pending={svg,url,png};
            // Verify the actual styled image, after curves, colours and logo are rendered.
            worker?.postMessage({type:'verify',frame:{pixels:rendered.data,width:rendered.width,height:rendered.height}},[rendered.data.buffer]);
          } catch { retryOrFinish(); }
        };
        worker.postMessage({type:'generate',frame,style:JSON.parse(key)});
      } finally { bitmap.close(); }
    })().catch(()=>finish(null));
    return () => { cancelled=true; clearTimeout(timeout); worker?.terminate(); urls.forEach(releaseURL); };
  }, [blob,key,allowFallback]);
  const matches=!!blob&&state?.source===blob&&state.key===key;
  return { formatted: matches?state.formatted:null, checking: !!blob&&(!matches||state.checking) };
}
