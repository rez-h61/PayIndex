import type { Person, QR } from './config';
export const demoPeople: Person[] = ['Alex Morgan', 'Jamie Chen', 'Jordan Lee', 'Sam Rivera'].map((display_name, i) => ({ id: `demo-${i+1}`, display_name, avatar_path: null, avatar_url: null, updated_at: '2026-10-06T00:00:00Z' }));
export const demoQRs: QR[] = [
  { id: 'sample-1', person_id: 'demo-1', label_key: 'maybank', label: 'Maybank', storage_path: '', updated_at: '2026-10-01T00:00:00Z' },
  { id: 'sample-2', person_id: 'demo-1', label_key: 'tngewallet', label: 'TnG eWallet', storage_path: '', updated_at: '2026-10-01T00:00:00Z' },
  { id: 'sample-3', person_id: 'demo-2', label_key: 'gxbank', label: 'GXBank', storage_path: '', updated_at: '2026-10-01T00:00:00Z' },
  { id: 'sample-4', person_id: 'demo-3', label_key: 'shopeepay', label: 'ShopeePay', storage_path: '', updated_at: '2026-10-01T00:00:00Z' },
];
