export const QR_PALETTES = {
  classic: { name: 'Classic', body: '#111111', eye: '#111111' },
  payindex: { name: 'PayIndex', body: '#202735', eye: '#943847' },
  midnight: { name: 'Midnight', body: '#24354b', eye: '#374c68' },
  cyber: { name: 'Cyber', body: '#0b5078', eye: '#036f9d' },
} as const;
export const QR_SHAPES = ['square', 'rounded', 'dots', 'classy'] as const;
export type QRStyle = { palette: keyof typeof QR_PALETTES; shape: typeof QR_SHAPES[number]; logo: boolean };
export const DEFAULT_QR_STYLE: QRStyle = { palette: 'classic', shape: 'square', logo: false };
export function validQRStyle(value: unknown): value is QRStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(',') === 'logo,palette,shape' &&
    typeof record.palette === 'string' && Object.hasOwn(QR_PALETTES, record.palette) &&
    QR_SHAPES.includes(record.shape as QRStyle['shape']) && typeof record.logo === 'boolean';
}
