import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { readFileSync } from 'node:fs';

test.use({ serviceWorkers: 'block' });
test('production QR works under real CSP without requesting a separate worker asset', async ({ page }) => {
  test.setTimeout(60_000);
  const payload='PAYINDEX-PRODUCTION-WORKER-REGRESSION-ONLY';
  const original=await QRCode.toBuffer(payload,{width:360,margin:4});
  const config=JSON.parse(readFileSync('vercel.json','utf8'));
  const csp=config.headers[0].headers.find((header:{key:string})=>header.key==='Content-Security-Policy').value;
  const errors:string[]=[], workerRequests:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/assets/*worker*.js',route=>{
    workerRequests.push(route.request().url());
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html>Missing old worker</html>'});
  });
  await page.route('http://127.0.0.1:4174/**',async route=>{
    if(route.request().resourceType()!=='document')return route.continue();
    const response=await route.fetch();
    return route.fulfill({response,headers:{...response.headers(),'content-security-policy':csp}});
  });
  await page.route('https://fixture.supabase.co/**',route=>{
    const request=route.request(),url=new URL(request.url());
    const json=(data:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(url.pathname.includes('/storage/'))return route.fulfill({contentType:'image/png',body:original,headers:{'access-control-allow-origin':'*'}});
    if(url.pathname.endsWith('directory_people'))return json([{id:'production-person',display_name:'Production Friend',avatar_path:null,avatar_url:null,updated_at:'2026-10-13T00:00:00Z'}]);
    if(url.pathname.endsWith('directory_qrs'))return json([{id:'production-qr',person_id:'production-person',label:'Test bank',label_key:'testbank',storage_path:'test.png',updated_at:'2026-10-13T00:00:00Z',qr_style:{palette:'payindex',shape:'rounded',logo:true}}]);
    return json(false);
  });
  await page.goto('http://127.0.0.1:4174/qr/production-qr');
  await expect(page.getByText('Styled QR',{exact:true})).toBeVisible({timeout:20000});
  const image=page.getByAltText('Production Friend’s Test bank receiving QR');
  const rendered=await image.evaluate((img:HTMLImageElement)=>{
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const context=canvas.getContext('2d')!;context.drawImage(img,0,0);
    return {pixels:[...context.getImageData(0,0,canvas.width,canvas.height).data],width:canvas.width,height:canvas.height};
  });
  expect(jsQR(new Uint8ClampedArray(rendered.pixels),rendered.width,rendered.height)?.data).toBe(payload);
  expect(workerRequests).toEqual([]);expect(errors).toEqual([]);
});
