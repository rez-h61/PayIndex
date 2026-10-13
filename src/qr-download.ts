// Export the verified QR artwork together with the recipient's identifying labels.
export async function qrDownloadCard(source: string, recipient: string, bank: string): Promise<Blob> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export unavailable');
  const width = 1200, padding = 40, qrSize = width - padding * 2;
  const wrap = (text: string, font: string) => {
    ctx.font = font;
    const lines: string[] = []; let line = '';
    for (const character of Array.from(text)) {
      if (line && ctx.measureText(line + character).width > width - 120) {
        lines.push(line.trim()); line = '';
      }
      line += character;
    }
    if (line) lines.push(line.trim());
    return lines;
  };
  const nameFont = '600 72px Arial, sans-serif', bankFont = '44px Arial, sans-serif';
  const names = wrap(recipient, nameFont), banks = wrap(bank, bankFont);
  const top = 110 + names.length * 86 + banks.length * 58 + 45;
  canvas.width = width; canvas.height = top + qrSize + padding;
  ctx.fillStyle = '#050607'; ctx.fillRect(0, 0, width, canvas.height);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = '#a9bdcf'; ctx.font = '24px monospace';
  ctx.fillText('R E C E I V I N G   Q R', width / 2, 40);
  ctx.fillStyle = '#ffffff'; ctx.font = nameFont;
  names.forEach((line, index) => ctx.fillText(line, width / 2, 105 + index * 86));
  ctx.fillStyle = '#a9bdcf'; ctx.font = bankFont;
  banks.forEach((line, index) => ctx.fillText(line, width / 2, 120 + names.length * 86 + index * 58));
  ctx.fillStyle = '#ffffff'; ctx.beginPath();
  ctx.roundRect(padding, top, qrSize, qrSize, 30); ctx.fill();
  ctx.save(); ctx.clip();
  // Keep every pixel and the QR's existing quiet zone; never crop the artwork.
  const scale = Math.min(qrSize / image.naturalWidth, qrSize / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, padding + (qrSize - w) / 2, top + (qrSize - h) / 2, w, h);
  ctx.restore();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image export failed')), 'image/png'));
}
