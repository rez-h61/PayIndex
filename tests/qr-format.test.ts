import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { cleanQR, cropQR, type QRFrame } from '../src/qr-format';

function fixture(payload: string | QRCode.QRCodeSegment[], version?: number) {
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

describe('verified Clean QR regeneration', () => {
  it.each([
    '000000000000001234567890',
    'PAYINDEX TEST: ABC123 / 45.67',
    '0002010102115204000053034585802MY5912TEST ONLY6002KL6304ABCD',
    'https://example.test/receive?amount=12.50&reference=a%2Bb',
    'Test Unicode: \u674e\u660e \ud83d\ude00',
  ])('preserves exact data and segment modes for %s', payload => {
    const original = fixture(payload);
    const before = original.pixels.slice();
    const source = jsQR(original.pixels, original.width, original.height)!;
    const clean = cleanQR(original)!;
    expect(clean).not.toBeNull();
    const decoded = jsQR(clean.pixels, clean.width, clean.height)!;
    expect(decoded.binaryData).toEqual(source.binaryData);
    expect(decoded.chunks).toEqual(source.chunks);
    expect(decoded.data).toBe(source.data);
    expect(original.pixels).toEqual(before);
    expect(clean.svg).toContain('shape-rendering="crispEdges"');
    expect(clean.svg).not.toContain(payload);
    expect(clean.pixels.every((value, index, pixels) =>
      index % 4 === 3 ? value === 255 :
      (value === 0 || value === 255) && value === pixels[index - index % 4]
    )).toBe(true);
  });

  it('preserves non-UTF-8 bytes, null bytes and mixed numeric/byte segments', () => {
    const original = fixture([
      { mode: 'numeric', data: '00001234567890' },
      { mode: 'byte', data: new Uint8Array([0, 128, 255, 1, 2, 65, 0, 192]) },
    ]);
    const source = jsQR(original.pixels, original.width, original.height)!;
    const clean = cleanQR(original)!;
    expect(clean).not.toBeNull();
    const decoded = jsQR(clean.pixels, clean.width, clean.height)!;
    expect(decoded.binaryData).toEqual(source.binaryData);
    expect(decoded.chunks).toEqual(source.chunks);
  });

  it('keeps unreadable images and multiple QR recipients as originals', () => {
    expect(cleanQR({ pixels: new Uint8ClampedArray(100 * 100 * 4).fill(255), width:100, height:100 })).toBeNull();
    const a=fixture('RECIPIENT-A'), b=fixture('RECIPIENT-B');
    const width=a.width+b.width, height=a.height, pixels=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++) {
      pixels.set(a.pixels.subarray(y*a.width*4,(y+1)*a.width*4),y*width*4);
      pixels.set(b.pixels.subarray(y*b.width*4,(y+1)*b.width*4),(y*width+a.width)*4);
    }
    expect(cleanQR({pixels,width,height})).toBeNull();
  });
});
