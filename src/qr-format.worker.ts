import { cropQR, type QRFrame } from './qr-format';

self.onmessage = (event: MessageEvent<QRFrame>) => {
  try {
    const result = cropQR(event.data);
    if (result) self.postMessage(result, { transfer: [result.pixels.buffer] });
    else self.postMessage(null);
  } catch { self.postMessage(null); }
};
