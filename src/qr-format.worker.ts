import { cleanQR, verifyQR, type QRFrame, type QRProof } from './qr-format';
import type { QRStyle } from './qr-style';
let proof: QRProof | null = null;
self.onmessage = (event: MessageEvent<{ type: 'generate'; frame: QRFrame; style?: QRStyle } | { type: 'verify'; frame: QRFrame }>) => {
  try {
    if (event.data.type === 'verify') {
      self.postMessage({ type: 'verified', valid: !!proof && verifyQR(event.data.frame, proof) });
      return;
    }
    const result = cleanQR(event.data.frame, event.data.style);
    proof = result?.proof ?? null;
    self.postMessage({ type: 'generated', result: result ? { svg: result.svg, width: result.width, height: result.height } : null });
  } catch { proof = null; self.postMessage({ type: 'generated', result: null }); }
};
