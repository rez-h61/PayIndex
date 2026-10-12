import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { readFileSync } from 'node:fs';

test('existing bank QR auto-formats, toggles original and downloads both versions', async ({ page }) => {
  test.setTimeout(60_000);
  const dataURL = await QRCode.toDataURL('PAYINDEX-FICTIONAL-QR-TEST-ONLY', { width: 240, margin: 4 });
  await page.goto('/?demo=1');
  const screenshot = await page.evaluate(async qr => {
    const image = new Image(); image.src = qr; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 700;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,480,700);
    ctx.fillStyle = '#e5bc41'; ctx.fillRect(0,0,480,100);
    ctx.fillStyle = '#222'; ctx.font = '24px sans-serif'; ctx.fillText('Fictional bank',30,60);
    ctx.drawImage(image,120,180); ctx.fillText('Receive money',145,510);
    return canvas.toDataURL('image/png');
  }, dataURL);
  const original = Buffer.from(screenshot.split(',')[1], 'base64');
  await page.route('https://fixture.supabase.co/**', route => {
    const url = new URL(route.request().url());
    const json = (data: unknown) => route.fulfill({ contentType:'application/json', body:JSON.stringify(data) });
    if (url.pathname.includes('/storage/')) return route.fulfill({contentType:'image/png', body:original});
    if (url.pathname.endsWith('is_directory_admin')) return json(false);
    if (url.pathname.endsWith('directory_people')) return json([{id:'format-person',display_name:'Preview Friend',avatar_path:null,avatar_url:null,updated_at:'2026-10-13T00:00:00Z'}]);
    if (url.pathname.endsWith('directory_qrs')) return json([{id:'format-qr',person_id:'format-person',label:'Fictional bank',label_key:'fictionalbank',storage_path:'fixture.png',updated_at:'2026-10-13T00:00:00Z'}]);
    return json({});
  });
  await page.goto('/qr/format-qr');
  await expect(page.getByText('Clean QR ready. Original data verified.')).toBeVisible({timeout:20000});
  const image = page.getByAltText('Preview Friend’s Fictional bank receiving QR');
  const size = await image.evaluate((img: HTMLImageElement) => [img.naturalWidth,img.naturalHeight]);
  expect(size[0]).toBe(size[1]); expect(size[1]).toBeGreaterThan(240);
  const rendered = await image.evaluate((img: HTMLImageElement) => {
    const canvas=document.createElement('canvas'); canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d')!; ctx.drawImage(img,0,0);
    return {pixels:[...ctx.getImageData(0,0,canvas.width,canvas.height).data],width:canvas.width,height:canvas.height};
  });
  expect(jsQR(new Uint8ClampedArray(rendered.pixels),rendered.width,rendered.height)?.data).toBe('PAYINDEX-FICTIONAL-QR-TEST-ONLY');
  await page.screenshot({path:`test-results/auto-format-${test.info().project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:'Show original QR',exact:true}).click();
  await expect.poll(()=>image.evaluate((img:HTMLImageElement)=>img.naturalHeight)).toBe(700);
  await page.getByRole('button',{name:'Show clean QR',exact:true}).click();
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button',{name:'Save QR',exact:true}).click();
  expect(readFileSync((await (await originalDownload).path())!)).toEqual(original);
  const formattedDownload = page.waitForEvent('download');
  await page.getByRole('button',{name:'Save clean QR',exact:true}).click();
  const formatted = readFileSync((await (await formattedDownload).path())!);
  expect(formatted).not.toEqual(original);
  expect(formatted.subarray(1,4).toString()).toBe('PNG');
  const pngPixels=await page.evaluate(async data=>{
    const img=new Image();img.src=data;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);
    return {pixels:[...ctx.getImageData(0,0,canvas.width,canvas.height).data],width:canvas.width,height:canvas.height};
  },`data:image/png;base64,${formatted.toString('base64')}`);
  expect(jsQR(new Uint8ClampedArray(pngPixels.pixels),pngPixels.width,pngPixels.height)?.data).toBe('PAYINDEX-FICTIONAL-QR-TEST-ONLY');
  const vectorDownload=page.waitForEvent('download');
  await page.getByRole('link',{name:'Download SVG',exact:true}).click();
  const vector=readFileSync((await (await vectorDownload).path())!,'utf-8');
  expect(vector).toContain('shape-rendering="crispEdges"');
  expect(vector).not.toContain('PAYINDEX-FICTIONAL-QR-TEST-ONLY');
});
