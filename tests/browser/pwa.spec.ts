import { test, expect } from '@playwright/test';
test('production shell and dark icons work offline without caching directory responses',async({page,context})=>{
 await page.route('https://*.supabase.co/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Offline fixture"}'}));
 await page.goto('http://127.0.0.1:4174/');await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 const manifest=await page.evaluate(async()=>(await fetch('/manifest.webmanifest')).json());expect(manifest.display).toBe('standalone');expect(manifest.theme_color).toBe('#040506');expect(manifest.icons.some((i:{purpose?:string})=>i.purpose==='maskable')).toBe(true);
 const size=await page.evaluate(async()=>{const i=new Image();i.src='/icon-512.png';await i.decode();return[i.naturalWidth,i.naturalHeight];});expect(size).toEqual([512,512]);
 await page.evaluate(async()=>{await fetch('/rest/v1/directory_people?cache-probe=1');});
 const cached=await page.evaluate(async()=>{const result:string[]=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())result.push(req.url);return result;});
 expect(cached.length).toBeGreaterThan(0);expect(cached.every(u=>new URL(u).origin==='http://127.0.0.1:4174'&&!u.includes('/rest/')&&!u.includes('/storage/')&&!u.includes('?'))).toBe(true);
 expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);expect(await page.evaluate(async()=>(await indexedDB.databases()).length)).toBe(0);
 await context.setOffline(true);await page.reload();await expect(page.getByRole('heading',{name:'A connection, please.'})).toBeVisible();await context.setOffline(false);
});
