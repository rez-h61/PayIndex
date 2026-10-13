import {QR_COLOURS,QR_DESIGNS,QR_PALETTES,validQRStyle} from '../src/qr-style';
import { describe, it, expect } from 'vitest';
import { labelKey, validDuitNowAccount, validLabel, validName, validImageURL } from '../src/config';
import { inspectImage } from '../supabase/functions/_shared/images';
describe('input validation', () => {
  it('allows blank transfer accounts and numeric identifiers', () => { expect(validDuitNowAccount('')).toBe(true); expect(validDuitNowAccount('00123456789')).toBe(true); expect(validDuitNowAccount('1'.repeat(34))).toBe(true); for (const value of ['1'.repeat(35), '123abc', '123 456', '12-34', '+60123456789']) expect(validDuitNowAccount(value)).toBe(false); });
  it('normalizes label punctuation, case, and spaces consistently', () => { expect(labelKey(' ACME-Pay ')).toBe(labelKey('acme pay')); expect(labelKey('ACME.Pay')).toBe('acmepay'); });
  it('bounds names and labels', () => { expect(validName('  ')).toBe(false); expect(validName('x'.repeat(61))).toBe(false); expect(validName('A\nB')).toBe(false); expect(validName('李明')).toBe(true); expect(validLabel('A & B')).toBe(true); expect(validLabel('💰')).toBe(false); expect(validImageURL('https://example.com/photo.jpg')).toBe(true); expect(validImageURL('javascript:alert(1)')).toBe(false); expect(validImageURL('https://user:password@example.com/photo.jpg')).toBe(false); });
  it('rejects spoofed MIME content and truncated images', () => { expect(inspectImage(new TextEncoder().encode('<svg><script>alert(1)</script></svg>'))).toBeNull(); expect(inspectImage(new Uint8Array([137,80,78,71]))).toBeNull(); expect(inspectImage(new Uint8Array(5*1024*1024+1))).toBeNull(); });
  it('accepts a complete original PNG without transforming its bytes', () => { const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=', 'base64')); expect(inspectImage(bytes)).toEqual({mime:'image/png',ext:'png',width:1,height:1}); expect(inspectImage(bytes.slice(0,-4))).toBeNull(); });
});

describe('QR palette validation',()=>{
 it('offers exactly 15 colours including the supplied pink and keeps all style options strict',()=>{
  expect(Object.keys(QR_PALETTES)).toHaveLength(15);expect(QR_PALETTES.pink.body).toBe('#ed3068');expect(QR_PALETTES.pink.eye).toBe('#ed3068');
  for(const palette of Object.keys(QR_PALETTES))expect(validQRStyle({palette,shape:'square',logo:false})).toBe(true);
  expect(Object.keys(QR_COLOURS)).toHaveLength(15);
  for(const palette of QR_DESIGNS)for(const colour of Object.keys(QR_COLOURS))expect(validQRStyle({palette,colour,shape:'rounded',logo:true})).toBe(true);
  expect(validQRStyle({palette:'classic',colour:'unknown',shape:'square',logo:false})).toBe(false);
  expect(validQRStyle({palette:'classic',colour:null,shape:'square',logo:false})).toBe(false);
  expect(validQRStyle({palette:'custom',shape:'square',logo:false})).toBe(false);
  expect(validQRStyle({palette:'pink',shape:'square',logo:'yes'})).toBe(false);
 });
});
