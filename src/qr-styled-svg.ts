import type { QRCode } from 'qrcode';
import icon from './assets/payindex-icon.svg?raw';
import { QR_PALETTES, type QRStyle } from './qr-style';

export function styledSVG(qr: QRCode, style: QRStyle, size: number) {
  const n = qr.modules.size, margin = 8, side = n + margin * 2;
  const colors = QR_PALETTES[style.palette];
  const shapes: string[] = [];
  const dark = (x:number,y:number) => x>=0&&y>=0&&x<n&&y<n&&!!qr.modules.get(y,x);
  const roundedModule = (x:number,y:number,tl:number,tr:number,br:number,bl:number) =>
    `M${x+tl} ${y}H${x+1-tr}Q${x+1} ${y} ${x+1} ${y+tr}V${y+1-br}Q${x+1} ${y+1} ${x+1-br} ${y+1}H${x+bl}Q${x} ${y+1} ${x} ${y+1-bl}V${y+tl}Q${x} ${y} ${x+tl} ${y}Z`;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!dark(x,y)) continue;
    const eye = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    if(eye)continue; // Finder eyes are drawn as continuous rings below.
    const px=x+margin,py=y+margin;
    const shape=qr.modules.isReserved(y,x)?'square':style.shape;
    if(shape==='dots')shapes.push(`<circle cx="${px+.5}" cy="${py+.5}" r=".43" fill="${colors.body}"/>`);
    else if(shape==='rounded'||shape==='classy') {
      // Round only exposed corners: neighbouring modules join into continuous paths.
      const up=dark(x,y-1),down=dark(x,y+1),left=dark(x-1,y),right=dark(x+1,y);
      const radius=shape==='rounded'?.5:.8;
      const tl=!up&&!left?radius:0,br=!down&&!right?radius:0;
      const tr=shape==='rounded'&&!up&&!right?radius:0;
      const bl=shape==='rounded'&&!down&&!left?radius:0;
      shapes.push(`<path d="${roundedModule(px,py,tl,tr,br,bl)}" fill="${colors.body}"/>`);
    } else shapes.push(`<path d="M${px} ${py}h1v1h-1z" fill="${colors.body}"/>`);
  }
  for(const [x,y] of [[margin,margin],[margin+n-7,margin],[margin,margin+n-7]]) {
    if(style.shape==='dots') {
      shapes.push(`<circle cx="${x+3.5}" cy="${y+3.5}" r="3.5" fill="${colors.eye}"/><circle cx="${x+3.5}" cy="${y+3.5}" r="2.5" fill="#fff"/><circle cx="${x+3.5}" cy="${y+3.5}" r="1.5" fill="${colors.eye}"/>`);
    } else {
      const outer=style.shape==='rounded'?2:0,inner=style.shape==='rounded'?1.2:0,pupil=style.shape==='rounded'?1.3:0;
      shapes.push(`<rect x="${x}" y="${y}" width="7" height="7" rx="${outer}" fill="${colors.eye}"/><rect x="${x+1}" y="${y+1}" width="5" height="5" rx="${inner}" fill="#fff"/><rect x="${x+2}" y="${y+2}" width="3" height="3" rx="${pupil}" fill="${colors.eye}"/>`);
    }
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
