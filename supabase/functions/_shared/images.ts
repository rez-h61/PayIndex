// Header/dimension checks on the server supplement bucket MIME/size restrictions.
// This is format validation, never proof that an image contains a safe receiving QR.
export function inspectImage(bytes: Uint8Array): { mime: string; ext: string; width: number; height: number } | null {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return null;
  const b = bytes, v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let mime = '', ext = '', width = 0, height = 0;
  if (b.length >= 45 && [137,80,78,71,13,10,26,10].every((n,i) => b[i] === n)) {
    if (v.getUint32(8) !== 13 || String.fromCharCode(...b.slice(12,16)) !== 'IHDR') return null;
    // Require a complete chunk stream with IDAT and IEND, and no appended payload.
    let at = 8, data = false, end = false;
    while (at + 12 <= b.length) {
      const len = v.getUint32(at); if (len > b.length - at - 12) return null;
      const type = String.fromCharCode(...b.slice(at + 4, at + 8));
      if (type === 'IDAT') data = true;
      at += len + 12;
      if (type === 'IEND') { end = len === 0 && at === b.length; break; }
    }
    if (!data || !end) return null;
    width = v.getUint32(16); height = v.getUint32(20); mime = 'image/png'; ext = 'png';
  } else if (b.length > 20 && b[0] === 255 && b[1] === 216 && b[b.length-2] === 255 && b[b.length-1] === 217) {
    let at = 2;
    while (at + 8 < b.length) {
      if (b[at++] !== 255) return null;
      while (b[at] === 255) at++;
      const marker = b[at++];
      if (marker === 0xda || marker === 0xd9) break;
      const len = v.getUint16(at); if (len < 2 || at + len > b.length) return null;
      if ([0xc0,0xc1,0xc2].includes(marker)) { if (len < 8) return null; height = v.getUint16(at+3); width = v.getUint16(at+5); }
      at += len;
    }
    mime = 'image/jpeg'; ext = 'jpg';
  } else if (b.length >= 30 && String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP' && v.getUint32(4,true)+8 === b.length) {
    let at = 12, found = false;
    while (at + 8 <= b.length) {
      const type = String.fromCharCode(...b.slice(at,at+4)), len = v.getUint32(at+4,true), start = at+8;
      if (start+len > b.length) return null;
      if (type === 'ANIM' || type === 'ANMF') return null; // Receiving images must be static.
      if (type === 'VP8 ' && len >= 10 && b[start+3] === 0x9d && b[start+4] === 1 && b[start+5] === 0x2a) { width=v.getUint16(start+6,true)&0x3fff; height=v.getUint16(start+8,true)&0x3fff; found=true; }
      if (type === 'VP8L' && len >= 5 && b[start] === 0x2f) { const bits=v.getUint32(start+1,true); width=(bits&0x3fff)+1; height=((bits>>>14)&0x3fff)+1; found=true; }
      at=start+len+(len%2);
    }
    if (!found || at !== b.length) return null;
    mime = 'image/webp'; ext = 'webp';
  }
  if (!width || !height || width * height > 40_000_000) return null;
  return { mime, ext, width, height };
}
