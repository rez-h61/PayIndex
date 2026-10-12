import jsQR from 'jsqr';

export type QRFrame = { pixels: Uint8ClampedArray; width: number; height: number };

// Crop original pixels, never recreate or change the encoded payment payload.
export function cropQR({ pixels, width, height }: QRFrame): QRFrame | null {
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
