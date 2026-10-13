import jsQR from 'jsqr';
import QRCode, { type QRCodeSegment } from 'qrcode';
import { DEFAULT_QR_STYLE, validQRStyle, type QRStyle } from './qr-style';
import { styledSVG } from './qr-styled-svg';

export type QRFrame = { pixels: Uint8ClampedArray; width: number; height: number };
export type QRProof = Pick<NonNullable<ReturnType<typeof jsQR>>, 'data' | 'binaryData' | 'chunks'>;
export type CleanQRFrame = QRFrame & { svg: string; proof: QRProof };

export function verifyQR(frame: QRFrame, proof: QRProof) {
  const decoded = jsQR(frame.pixels, frame.width, frame.height);
  return !!decoded && decoded.data === proof.data &&
    JSON.stringify(decoded.chunks) === JSON.stringify(proof.chunks) &&
    decoded.binaryData.length === proof.binaryData.length &&
    decoded.binaryData.every((byte, i) => byte === proof.binaryData[i]);
}

function findSingleQR({ pixels, width, height }: QRFrame) {
  const code = jsQR(pixels, width, height);
  if (!code) return null;
  const corners = [code.location.topLeftCorner, code.location.topRightCorner,
    code.location.bottomLeftCorner, code.location.bottomRightCorner];
  const left = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x)) - 2));
  const top = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y)) - 2));
  const right = Math.min(width, Math.ceil(Math.max(...corners.map(p => p.x)) + 2));
  const bottom = Math.min(height, Math.ceil(Math.max(...corners.map(p => p.y)) + 2));
  const w = right - left, h = bottom - top;
  if (w <= 0 || h <= 0) return null;

  // Avoid silently selecting one recipient from an image with multiple QRs.
  const masked = pixels.slice();
  for (let y = top; y < bottom; y++) masked.fill(255, (y * width + left) * 4, (y * width + right) * 4);
  if (jsQR(masked, width, height)) return null;

  return { code, left, top, right, bottom, w, h };
}

// Crop original pixels, never recreate or change the encoded payment payload.
export function cropQR(frame: QRFrame): QRFrame | null {
  const detected = findSingleQR(frame);
  if (!detected) return null;
  const { code, left, top, right, w, h } = detected;
  const { pixels, width } = frame;
  // At least eight modules of white padding on every side, with square framing.
  const modules = 17 + code.version * 4;
  const padding = Math.max(16, Math.ceil(Math.max(w, h) / modules * 8));
  const size = Math.max(w, h) + padding * 2;
  const output = new Uint8ClampedArray(size * size * 4).fill(255);
  const dx = Math.floor((size - w) / 2), dy = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++) {
    output.set(pixels.subarray(((top + y) * width + left) * 4,
      ((top + y) * width + right) * 4), ((dy + y) * size + dx) * 4);
  }
  const verified = jsQR(output, size, size);
  if (!verified || verified.binaryData.length !== code.binaryData.length ||
    !verified.binaryData.every((byte, i) => byte === code.binaryData[i])) return null;
  return { pixels: output, width: size, height: size };
}

export function cleanQR(frame: QRFrame, style: QRStyle = DEFAULT_QR_STYLE): CleanQRFrame | null {
  if (!validQRStyle(style)) return null;
  const detected = findSingleQR(frame);
  if (!detected) return null;
  const { code } = detected;
  const segments: QRCodeSegment[] = [];
  for (const chunk of code.chunks) {
    if (chunk.type === 'byte' && 'bytes' in chunk) {
      // Do not round-trip through Unicode: arbitrary payload bytes must survive.
      segments.push({ mode: 'byte', data: new Uint8Array(chunk.bytes) });
    } else if (chunk.type === 'numeric' && 'text' in chunk) {
      segments.push({ mode: 'numeric', data: chunk.text });
    } else if (chunk.type === 'alphanumeric' && 'text' in chunk) {
      segments.push({ mode: 'alphanumeric', data: chunk.text });
    } else {
      // ECI/Kanji or other special encoding needs more than a byte comparison.
      return null;
    }
  }
  if (!segments.length) return null;
  let generated: ReturnType<typeof QRCode.create>;
  try { generated = QRCode.create(segments, { errorCorrectionLevel: style.logo ? 'H' : 'M' }); }
  catch { return null; }
  const margin = 8, scale = 8, side = generated.modules.size + margin * 2, size = side * scale;
  const output = new Uint8ClampedArray(size * size * 4).fill(255);
  const paths: string[] = [];
  for (let y = 0; y < generated.modules.size; y++) for (let x = 0; x < generated.modules.size; x++) {
    if (!generated.modules.get(y, x)) continue;
    paths.push(`M${x + margin} ${y + margin}h1v1h-1z`);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const offset = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
      output[offset] = output[offset + 1] = output[offset + 2] = 0;
    }
  }
  const verified = jsQR(output, size, size);
  if (!verified || verified.data !== code.data ||
    JSON.stringify(verified.chunks) !== JSON.stringify(code.chunks) ||
    verified.binaryData.length !== code.binaryData.length ||
    !verified.binaryData.every((byte, i) => byte === code.binaryData[i])) return null;
  // SVG contains only fixed markup and generated integer coordinates, never payload text.
  const plain = style.palette === 'classic' && style.shape === 'square' && !style.logo;
  const svg = plain ? `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${side}v${side}H0z"/><path fill="#000" d="${paths.join('')}"/></svg>` : styledSVG(generated, style, size);
  return { pixels: output, width: size, height: size, svg,
    proof: { data: code.data, binaryData: code.binaryData, chunks: code.chunks } };
}
