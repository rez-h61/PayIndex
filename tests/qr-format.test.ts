import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { cropQR, type QRFrame } from '../src/qr-format';

function fixture(payload: string, version?: number) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M', version });
  const scale = 5, width = qr.modules.size * scale + 160, height = width + 220;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  // A bank-style coloured header, with the actual QR lower down the screenshot.
  for (let y = 0; y < 65; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    pixels[offset] = 60; pixels[offset + 1] = 95; pixels[offset + 2] = 130;
  }
  for (let y = 0; y < qr.modules.size; y++) for (let x = 0; x < qr.modules.size; x++) {
    if (!qr.modules.get(y, x)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const offset = ((y * scale + 120 + dy) * width + x * scale + 80 + dx) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    }
  }
  return { pixels, width, height };
}

describe('verified QR cropping', () => {
  it.each([1, 5, 10])('crops bank-style screenshots and preserves raw payload for version %i', version => {
    const original = fixture('TEST-ONLY-QR', version);
    const before = original.pixels.slice();
    const crop = cropQR(original)!;
    expect(crop).not.toBeNull();
    expect(crop.width).toBe(crop.height);
    expect(crop.height).toBeLessThan(original.height);
    expect(jsQR(crop.pixels, crop.width, crop.height)?.data).toBe('TEST-ONLY-QR');
    expect(original.pixels).toEqual(before);
    // White borders on all four sides, enough for the quiet zone.
    for (let n = 0; n < crop.width; n++) {
      for (const index of [n, (crop.height - 1) * crop.width + n, n * crop.width, n * crop.width + crop.width - 1]) {
        expect([...crop.pixels.slice(index * 4, index * 4 + 4)]).toEqual([255,255,255,255]);
      }
    }
  });
  it('falls back for images without a readable QR', () => {
    expect(cropQR({ pixels: new Uint8ClampedArray(200 * 200 * 4).fill(255), width: 200, height: 200 })).toBeNull();
  });
  it('does not choose a recipient from a screenshot with two QRs', () => {
    const a = fixture('RECIPIENT-A'), b = fixture('RECIPIENT-B');
    const combined: QRFrame = { width: a.width + b.width, height: a.height, pixels: new Uint8ClampedArray((a.width + b.width) * a.height * 4) };
    for (let y = 0; y < a.height; y++) {
      combined.pixels.set(a.pixels.subarray(y * a.width * 4, (y + 1) * a.width * 4), y * combined.width * 4);
      combined.pixels.set(b.pixels.subarray(y * b.width * 4, (y + 1) * b.width * 4), (y * combined.width + a.width) * 4);
    }
    expect(cropQR(combined)).toBeNull();
  });
});
