import type { QRStyle } from './qr-style';
export const APP_NAME = 'PayIndex';
export const PROVIDERS = ['Maybank', 'TnG eWallet', 'ShopeePay', 'GXBank'];
export const MAX_BYTES = 4 * 1024 * 1024;
export const ASSET_BUCKET = 'directory-assets';
export type Person = { id: string; display_name: string; avatar_path: string | null; avatar_url: string | null; updated_at: string };
export type QR = { id: string; person_id: string; label: string; label_key: string; storage_path: string; duitnow_account?: string | null; qr_style?: QRStyle | null; updated_at: string };
export function validName(value: string) { return value.trim().length >= 1 && value.trim().length <= 60 && !/[\x00-\x1f\x7f]/.test(value); }
export function labelKey(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
export function validLabel(value: string) { return /^[A-Za-z0-9][A-Za-z0-9 .&()'_-]{0,39}$/.test(value.trim()); }
export function validImageURL(value: string) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && value.length <= 2048; } catch { return false; }
}

export function validDuitNowAccount(value: string) { return value === "" || /^[0-9]{1,34}$/.test(value); }
