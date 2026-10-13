export const QR_PALETTES = {
  classic: { name: 'Classic', body: '#111111', eye: '#111111' },
  payindex: { name: 'PayIndex', body: '#202735', eye: '#943847' },
  midnight: { name: 'Midnight', body: '#24354b', eye: '#374c68' },
  cyber: { name: 'Cyber', body: '#0b5078', eye: '#036f9d' },
  pink: { name: 'Pink', body: '#ed3068', eye: '#ed3068' },
  crimson: { name: 'Crimson', body: '#a61d3d', eye: '#a61d3d' },
  coral: { name: 'Coral', body: '#bb453d', eye: '#bb453d' },
  amber: { name: 'Amber', body: '#8a5708', eye: '#8a5708' },
  olive: { name: 'Olive', body: '#596923', eye: '#596923' },
  forest: { name: 'Forest', body: '#196542', eye: '#196542' },
  teal: { name: 'Teal', body: '#08716c', eye: '#08716c' },
  ocean: { name: 'Ocean', body: '#165fa2', eye: '#165fa2' },
  indigo: { name: 'Indigo', body: '#44429b', eye: '#44429b' },
  violet: { name: 'Violet', body: '#743b98', eye: '#743b98' },
  plum: { name: 'Plum', body: '#7a315b', eye: '#7a315b' },
} as const;
export const QR_DESIGNS = ['classic', 'payindex', 'midnight', 'cyber'] as const;
export const QR_COLOURS = {
  black: { name: 'Black', hex: '#111111' },
  slate: { name: 'Slate', hex: '#202735' },
  navy: { name: 'Navy', hex: '#24354b' },
  blue: { name: 'Blue', hex: '#0b5078' },
  ...Object.fromEntries(Object.entries(QR_PALETTES).filter(([key]) => !QR_DESIGNS.includes(key as typeof QR_DESIGNS[number])).map(([key,value]) => [key,{name:value.name,hex:value.body}])),
} as Record<string, {name:string;hex:string}>;
export const QR_SHAPES = ['square', 'rounded', 'dots', 'classy'] as const;
export type QRStyle = { palette: keyof typeof QR_PALETTES; shape: typeof QR_SHAPES[number]; logo: boolean; colour?: string };
export const DEFAULT_QR_STYLE: QRStyle = { palette: 'classic', shape: 'square', logo: false };
export function validQRStyle(value: unknown): value is QRStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ['logo,palette,shape','colour,logo,palette,shape'].includes(Object.keys(record).sort().join(',')) &&
    (record.colour === undefined || (typeof record.colour === 'string' && Object.hasOwn(QR_COLOURS,record.colour) && QR_DESIGNS.includes(record.palette as typeof QR_DESIGNS[number]))) &&
    typeof record.palette === 'string' && Object.hasOwn(QR_PALETTES, record.palette) &&
    QR_SHAPES.includes(record.shape as QRStyle['shape']) && typeof record.logo === 'boolean';
}
