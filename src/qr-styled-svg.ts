import type { QRCode } from 'qrcode';
import icon from './assets/payindex-icon.svg?raw';
import { QR_PALETTES, type QRStyle } from './qr-style';

export function styledSVG(qr: QRCode, style: QRStyle, size: number) {
  const n = qr.modules.size, margin = 8, side = n + margin * 2;
  const colors = QR_PALETTES[style.palette];
  const shapes: string[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!qr.modules.get(y, x)) continue;
    const eye = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    const fill = eye ? colors.eye : colors.body;
    const px = x + margin, py = y + margin;
    // Preserve finder, timing, alignment and format/version modules as squares.
    const shape = qr.modules.isReserved(y, x) ? 'square' : style.shape;
    if (shape === 'dots') shapes.push(`<circle cx="${px + .5}" cy="${py + .5}" r=".49" fill="${fill}"/>`);
    else if (shape === 'rounded') shapes.push(`<rect x="${px}" y="${py}" width="1" height="1" rx=".22" fill="${fill}"/>`);
    else if (shape === 'classy') shapes.push(`<path d="M${px + .4} ${py}h.6v.6q0 .4-.4 .4h-.6v-.6q0-.4 .4-.4Z" fill="${fill}"/>`);
    else shapes.push(`<path d="M${px} ${py}h1v1h-1z" fill="${fill}"/>`);
  }
  if (style.logo) {
    // Small central badge, with high error correction selected by cleanQR.
    const badge = Math.max(3, Math.min(7, Math.floor(n * .13) | 1));
    const start = (side - badge) / 2;
    shapes.push(`<rect x="${start - .45}" y="${start - .45}" width="${badge + .9}" height="${badge + .9}" rx=".7" fill="#fff"/>`);
    shapes.push(icon.replace('<svg ', `<svg x="${start}" y="${start}" width="${badge}" height="${badge}" `));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${side} ${side}"><path fill="#fff" d="M0 0h${side}v${side}H0z"/>${shapes.join('')}</svg>`;
}
