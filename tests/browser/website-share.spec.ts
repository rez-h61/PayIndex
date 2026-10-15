import { installAdminFixture } from './admin-fixture';
import type { Route } from '@playwright/test';
import { test, expect } from '@playwright/test';
import jsQR from 'jsqr';

test('website share QR is fixed, publicly visible, and its link is editable only by the admin',async({page})=>{
  test.setTimeout(120_000);
  let settings={share_url:'https://payindex-kokoro.vercel.app/',updated_at:'2026-10-13T00:00:00Z'};
  const writes:unknown[]=[];
  const backendFixture = async (route: Route) => {
    const req=route.request(),url=new URL(req.url());if(url.pathname==='/api/admin')url.pathname='/functions/v1/directory-manage';
    const json=(value:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(url.pathname.endsWith('directory_settings'))return json(settings);
    if(url.pathname.endsWith('directory_people')||url.pathname.endsWith('directory_qrs'))return json([]);
    if(url.pathname.endsWith('directory-manage')){
      const form=await new Response(req.postDataBuffer()!,{headers:{'content-type':req.headers()['content-type']}}).formData();
      expect(form.get('action')).toBe('save_share_url');expect(form.get('qr_style')).toBeNull();expect(form.get('expected_updated_at')).toBe(settings.updated_at);
      writes.push(form.get('share_url'));settings={share_url:String(form.get('share_url')),updated_at:'2026-10-13T01:00:00Z'};
      return json({saved:true});
    }
    return json({});
  };
  await page.route('https://fixture.supabase.co/**',backendFixture);
  await installAdminFixture(page,backendFixture);
  const show=async()=>{await page.getByRole('button',{name:'Install and help'}).click();await page.getByRole('button',{name:'Share PayIndex QR',exact:true}).click();await expect(page.getByAltText('PayIndex website share QR')).toBeVisible({timeout:20000});};
  const scan=async()=>{
    const pixels=await page.getByAltText('PayIndex website share QR').evaluate((img:HTMLImageElement)=>{
      const canvas=document.createElement('canvas');canvas.width=600;canvas.height=600;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0,600,600);
      return [...ctx.getImageData(0,0,600,600).data];
    });
    return jsQR(new Uint8ClampedArray(pixels),600,600)?.data;
  };
  await page.goto('/');await show();
  expect(await scan()).toBe(settings.share_url);
  await expect(page.getByRole('dialog').getByRole('radio')).toHaveCount(0);
  await expect(page.getByText('Edit share link',{exact:true})).toHaveCount(0);
  await page.screenshot({path:`test-results/website-share-${test.info().project.name}.png`,fullPage:true});
  await page.keyboard.press('Escape');await page.goto('/admin/login');
  await page.getByLabel('Email',{exact:true}).fill('admin@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Manage directory',exact:true})).toBeVisible();await show();
  await page.getByText('Edit share link',{exact:true}).click();
  await page.getByLabel('Website link',{exact:true}).fill('https://example.test/new-directory?from=qr');
  await page.getByRole('button',{name:'Save share link',exact:true}).click();
  await expect(page.getByText('Website share link saved.',{exact:true})).toBeVisible();
  await expect.poll(scan,{timeout:20000}).toBe('https://example.test/new-directory?from=qr');
  expect(writes).toEqual(['https://example.test/new-directory?from=qr']);
  await page.context().clearCookies();await page.reload();await show();
  expect(await scan()).toBe(settings.share_url);await expect(page.getByText('Edit share link',{exact:true})).toHaveCount(0);
});
