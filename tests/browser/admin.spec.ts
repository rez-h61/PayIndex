import { installAdminFixture } from './admin-fixture';
import type { Route } from '@playwright/test';
// UI fixtures only: this suite does not claim a hosted Supabase integration.
import { test,expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test('admin can create a person, add/replace/save a QR, and delete using backend fixtures',async({page})=>{
 let people:any[]=[],qrs:any[]=[];const images=new Map<string,Buffer>();let version=0;let uploadedImage=Buffer.alloc(0);
 // Chromium request interception omits multipart file bytes. Capture the file
 // from the browser before sending so the fixture can return the exact original.
 await page.exposeFunction('__captureFixtureFile',(bytes:number[])=>{uploadedImage=Buffer.from(bytes);});
 await page.addInitScript(()=>{
  const send=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send=function(body){const file=body instanceof FormData?body.get('file'):null;if(file instanceof File){const xhr=this;void file.arrayBuffer().then(bytes=>(window as any).__captureFixtureFile([...new Uint8Array(bytes)])).then(()=>send.call(xhr,body));}else send.call(this,body);};
 });
 const png=readFileSync('public/icon-192.png');
 await page.route('https://images.example.test/**',route=>route.fulfill({status:200,contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:png}));
 const backendFixture = async (route: Route) => {
  const request=route.request(),url=new URL(request.url());if(url.pathname==='/api/admin')url.pathname='/functions/v1/directory-manage';const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body),headers:{'access-control-allow-origin':'*'}});
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
  if(url.pathname==='/rest/v1/directory_people')return json(people);
  if(url.pathname==='/rest/v1/directory_qrs')return json(qrs);
  if(url.pathname.startsWith('/storage/v1/object/')){const path=decodeURIComponent(url.pathname.split('/directory-assets/')[1]??'');return route.fulfill({status:images.has(path)?200:404,contentType:'image/png',body:images.get(path)??Buffer.from('missing')});}
  if(url.pathname==='/functions/v1/directory-manage'){
   const body=request.postDataBuffer()!;const form=await new Response(body,{headers:{'content-type':request.headers()['content-type']}}).formData();
   const action=form.get('action'),id=String(form.get('id'));const updated_at=new Date(Date.UTC(2026,9,6,0,0,++version)).toISOString();
   if(action==='save_person'){const person={id,display_name:String(form.get('display_name')),avatar_path:null,avatar_url:form.get('avatar_mode')==='link'?String(form.get('avatar_url')):null,updated_at};people=[...people.filter(p=>p.id!==id),person];}
   if(action==='save_qr'){const hasFile=form.get('file') instanceof File;const path=hasFile?`fixture/${id}/${version}.png`:qrs.find(q=>q.id===id)?.storage_path;expect(path).toBeTruthy();if(hasFile){expect(uploadedImage.length).toBeGreaterThan(0);images.set(path,Buffer.from(uploadedImage));}qrs=[...qrs.filter(q=>q.id!==id),{id,person_id:String(form.get('person_id')),label:String(form.get('label')),label_key:'maybank',duitnow_account:form.get('duitnow_account')||null,storage_path:path,updated_at}];}
   if(action==='delete_qr')qrs=qrs.filter(q=>q.id!==id);
   if(action==='delete_person'){people=people.filter(p=>p.id!==id);qrs=qrs.filter(q=>q.person_id!==id);}
   return json({id,cleanupPending:false});
  }
  return json({message:'Unexpected fixture request'},400);
  };
  await page.route('https://*.supabase.co/**',backendFixture);
  await installAdminFixture(page,backendFixture);
 await page.goto('/admin/login');await page.getByRole('textbox',{name:'Email',exact:true}).fill('admin@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Add person',exact:true}).click();await page.getByRole('textbox',{name:'Name',exact:true}).fill('Test Friend');await page.getByRole('radio',{name:'Image link',exact:true}).check();await page.getByRole('textbox',{name:'Direct image URL',exact:true}).fill('https://images.example.test/avatar.png');await page.getByRole('button',{name:'Save person',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Test Friend',exact:true})).toBeVisible();await page.getByRole('button',{name:'Add QR',exact:true}).click();await page.getByRole('combobox',{name:'Label',exact:true}).fill('Maybank');
 await page.getByLabel('Transferable account number (optional)').fill('00123456789');await page.getByRole('checkbox').check();await expect(page.getByRole('button',{name:'Save QR',exact:true})).toBeDisabled();await page.getByRole('checkbox').uncheck();
 await page.locator('input[type=file]').setInputFiles('public/icon-192.png');await expect(page.getByAltText('Original receiving QR preview')).toBeVisible();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save QR',exact:true}).click();
 await page.getByRole('button',{name:/Maybank Updated/}).click();const original=page.getByAltText('Test Friend’s Maybank receiving QR');await expect(original).toBeVisible();expect(await original.evaluate((image:HTMLImageElement)=>image.naturalWidth/image.naturalHeight)).toBe(1);
 await expect(page.getByText('TRANSFER ONLY',{exact:true})).toBeVisible();await expect(page.getByText('00123456789',{exact:true})).toBeVisible();
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Save QR',exact:true}).click();const download=await downloaded;expect(readFileSync((await download.path())!)).not.toEqual(png);
 await page.getByRole('button',{name:'Test Friend',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).click();await expect(page.getByLabel('Transferable account number (optional)')).toHaveValue('00123456789');await expect(page.getByAltText('Current receiving QR')).toBeVisible();await page.getByLabel('Transferable account number (optional)').fill('');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save QR',exact:true}).click();await page.getByRole('button',{name:/Maybank Updated/}).click();await expect(page.getByRole('button',{name:'Copy account number'})).toHaveCount(0);await expect(page.getByAltText('Test Friend’s Maybank receiving QR')).toBeVisible();await page.getByRole('button',{name:'Test Friend',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByText('Or use an image link',{exact:true}).click();await page.getByRole('textbox',{name:'Direct QR image URL',exact:true}).fill('https://images.example.test/qr.png');await page.getByRole('button',{name:'Load image',exact:true}).click();await expect(page.getByAltText('Original receiving QR preview')).toBeVisible();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save QR',exact:true}).click();
 await page.getByRole('button',{name:/Maybank Updated/}).click();await expect(page.getByRole('button',{name:'Copy account number'})).toHaveCount(0);await page.getByRole('button',{name:'Test Friend',exact:true}).click();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete',exact:true}).click();await expect(page.getByRole('heading',{name:'No QRs just yet.'})).toBeVisible();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete person',exact:true}).click();await expect(page.getByRole('heading',{name:'A place for your people.'})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Admin',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.includes('auth-token')))).toBe(false);
});
