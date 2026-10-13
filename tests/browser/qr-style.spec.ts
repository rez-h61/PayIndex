import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {readFileSync} from 'node:fs';

test('admin saves a verified design for only one QR, visitors get it, and reset restores default', async ({page}) => {
  test.setTimeout(120_000);
  const openOptions=async()=>{const details=page.locator('.qr-options');await expect(details).toBeVisible();if(!await details.evaluate((element:HTMLDetailsElement)=>element.open))await page.getByText('More options',{exact:true}).click();};
  const person='20000000-0000-4000-8000-000000000001';
  const first='30000000-0000-4000-8000-000000000001',second='30000000-0000-4000-8000-000000000002';
  const payload='0002010102115204000053034585802MY5912TEST ONLY6002KL6304ABCD';
  const png=await QRCode.toBuffer(payload,{width:400,margin:4});
  let version=0,readable=true,brokenSecond=false;
  const bulkWrites:unknown[]=[];
  const noQR=readFileSync('public/icon-192.png');
  const writes:unknown[]=[];
  let qrs=[{id:first,person_id:person,label:'First bank',label_key:'firstbank',storage_path:'first.png',updated_at:'2026-10-13T00:00:00Z',qr_style:null as unknown},
    {id:second,person_id:person,label:'Second bank',label_key:'secondbank',storage_path:'second.png',updated_at:'2026-10-13T00:00:00Z',qr_style:null as unknown}];
  await page.route('https://fixture.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(url.pathname.includes('/storage/'))return route.fulfill({contentType:'image/png',body:readable&&!(brokenSecond&&url.pathname.endsWith('second.png'))?png:noQR});
    if(url.pathname==='/auth/v1/token')return json({access_token:'fixture-admin-token',refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'10000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'admin@example.test',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-10-06T00:00:00Z'}});
    if(url.pathname.endsWith('is_directory_admin'))return json(req.headers().authorization?.includes('fixture-admin-token')??false);
    if(url.pathname==='/rest/v1/directory_people')return json([{id:person,display_name:'Style Friend',avatar_path:null,avatar_url:null,updated_at:'2026-10-13T00:00:00Z'}]);
    if(url.pathname==='/rest/v1/directory_qrs')return json(qrs);
    if(url.pathname==='/functions/v1/directory-manage'){
      const form=await new Response(req.postDataBuffer()!,{headers:{'content-type':req.headers()['content-type']}}).formData();
      if(form.get('action')==='bulk_qr_style'){
        const rows=JSON.parse(String(form.get('snapshot'))),design=JSON.parse(String(form.get('qr_style')));
        if(rows.length!==qrs.length||qrs.some(q=>!rows.some((row:{id:string;updated_at:string})=>row.id===q.id&&row.updated_at===q.updated_at)))return json({code:'conflict'},409);
        bulkWrites.push(design);qrs=qrs.map(q=>({...q,qr_style:design,updated_at:new Date(Date.UTC(2026,9,13,0,0,++version)).toISOString()}));return json({changed:qrs.length});
      }
      expect(form.get('action')).toBe('save_qr_style');expect(form.get('file')).toBeNull();
      const current=qrs.find(q=>q.id===form.get('id'))!;
      if(form.get('expected_updated_at')!==current.updated_at)return json({code:'conflict'},409);
      const design=JSON.parse(String(form.get('qr_style')));writes.push(design);
      qrs=qrs.map(q=>q.id===current.id?{...q,qr_style:design,updated_at:new Date(Date.UTC(2026,9,13,0,0,++version)).toISOString()}:q);
      return json({id:current.id});
    }
    return json({});
  });
  await page.goto(`/qr/${first}`);
  await openOptions();
  await expect(page.getByRole('button',{name:'Customize QR',exact:true})).toHaveCount(0);
  await page.goto('/admin/login');
  await page.getByLabel('Email',{exact:true}).fill('admin@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:/Style Friend/}).click();await page.getByRole('button',{name:/First bank Updated/}).click();
  await openOptions();await page.getByRole('button',{name:'Customize QR',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('radio',{name:'PayIndex',exact:true}).check();
  await dialog.getByRole('radio',{name:'Rounded',exact:true}).check();
  await dialog.getByRole('checkbox',{name:'Embed PayIndex logo'}).check();
  await expect(dialog.getByText('Scan check passed. Original data matches.')).toBeVisible({timeout:20000});
  await dialog.evaluate(element=>element.scrollTop=0);
  await page.screenshot({path:`test-results/qr-customizer-${test.info().project.name}.png`,fullPage:true});
  await dialog.getByRole('button',{name:'Save design',exact:true}).click();await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([{palette:'payindex',shape:'rounded',logo:true,colour:'black'}]);expect(qrs[1].qr_style).toBeNull();
  await expect(page.getByText('Styled QR',{exact:true})).toBeVisible({timeout:20000});
  await page.reload();await expect(page.getByText('Styled QR',{exact:true})).toBeVisible({timeout:20000});
  const image=page.getByAltText('Style Friend’s First bank receiving QR');
  const pixels=await image.evaluate((img:HTMLImageElement)=>{
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);return {pixels:[...ctx.getImageData(0,0,canvas.width,canvas.height).data],width:canvas.width,height:canvas.height};
  });
  expect(jsQR(new Uint8ClampedArray(pixels.pixels),pixels.width,pixels.height)?.data).toBe(payload);
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Save QR',exact:true}).click();
  const saved=readFileSync((await(await downloaded).path())!);
  const savedPixels=await page.evaluate(async data=>{
    const image=new Image();image.src=data;await image.decode();const canvas=document.createElement('canvas');canvas.width=800;canvas.height=Math.round(image.naturalHeight*800/image.naturalWidth);
    const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0,canvas.width,canvas.height);return {pixels:[...ctx.getImageData(0,0,canvas.width,canvas.height).data],width:canvas.width,height:canvas.height};
  },`data:image/png;base64,${saved.toString('base64')}`);
  expect(jsQR(new Uint8ClampedArray(savedPixels.pixels),savedPixels.width,savedPixels.height)?.data).toBe(payload);
  expect(saved).not.toEqual(png);
  // An anonymous visitor sees the persisted design but cannot customize it.
  await page.evaluate(()=>localStorage.clear());await page.reload();await expect(page.getByText('Styled QR',{exact:true})).toBeVisible({timeout:20000});
  await openOptions();await expect(page.getByRole('button',{name:'Customize QR',exact:true})).toHaveCount(0);
  await page.goto('/admin/login');await page.getByLabel('Email',{exact:true}).fill('admin@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.goto(`/qr/${second}`);await expect(page.getByText('Clean QR',{exact:true})).toBeVisible({timeout:20000});
  await page.goto(`/qr/${first}`);await openOptions();await page.getByRole('button',{name:'Customize QR',exact:true}).click();
  await dialog.getByRole('button',{name:'Reset to default Clean QR'}).click();await expect(dialog.getByText('Scan check passed. Original data matches.')).toBeVisible({timeout:20000});
  await dialog.getByRole('button',{name:'Save design',exact:true}).click();await expect(page.getByText('Clean QR',{exact:true})).toBeVisible({timeout:20000});expect(writes[1]).toBeNull();
  // Unreadable originals cannot enable a design save.
  readable=false;await page.reload();await openOptions();await page.getByRole('button',{name:'Customize QR',exact:true}).click();
  await expect(dialog.getByText('The original QR could not be regenerated safely. Retry the preview or use a clearer original.')).toBeVisible({timeout:20000});
  await expect(dialog.getByRole('button',{name:'Save design',exact:true})).toBeDisabled();expect(writes).toHaveLength(2);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  readable=true;await page.reload();await expect(page.getByText('Clean QR',{exact:true})).toBeVisible({timeout:20000});
  let blockWorker=true;
  await page.route('**/*qr-format.worker*',route=>blockWorker?route.abort():route.continue());
  await openOptions();await page.getByRole('button',{name:'Customize QR',exact:true}).click();
  await expect(dialog.getByText('The QR processor could not start. Refresh the page or retry the preview.')).toBeVisible({timeout:20000});
  await expect(dialog.getByRole('button',{name:'Save design',exact:true})).toBeDisabled();
  blockWorker=false;await dialog.getByRole('button',{name:'Retry preview',exact:true}).click();
  await expect(dialog.getByText('Scan check passed. Original data matches.')).toBeVisible({timeout:20000});


  await expect(dialog.getByRole('radio')).toHaveCount(23);
  await dialog.getByRole('radio',{name:'Pink',exact:true}).check();await dialog.getByRole('radio',{name:'Dots',exact:true}).check();
  await expect(dialog.getByText('Scan check passed. Original data matches.')).toBeVisible({timeout:20000});
  await dialog.getByRole('button',{name:'Apply this design to all QRs',exact:true}).click();
  await expect(dialog.getByText('All QRs passed the scan check.')).toBeVisible({timeout:30000});expect(bulkWrites).toHaveLength(0);
  await dialog.getByRole('button',{name:'Back',exact:true}).click();await expect(dialog.getByRole('radio',{name:'Pink',exact:true})).toBeChecked();
  await dialog.getByRole('button',{name:'Apply this design to all QRs',exact:true}).click();
  await expect(dialog.getByText('All QRs passed the scan check.')).toBeVisible({timeout:30000});
  await dialog.getByRole('button',{name:'Apply to all 2 QRs',exact:true}).click();await expect(dialog).toHaveCount(0);
  expect(qrs.every(q=>JSON.stringify(q.qr_style)===JSON.stringify({palette:'classic',shape:'dots',logo:false,colour:'pink'}))).toBe(true);
  await openOptions();await page.getByRole('button',{name:'Customize QR',exact:true}).click();
  await dialog.getByRole('button',{name:'Reset all QRs to default',exact:true}).click();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(bulkWrites).toHaveLength(1);
  await page.getByRole('button',{name:'Customize QR',exact:true}).click();await dialog.getByRole('button',{name:'Reset all QRs to default',exact:true}).click();
  await dialog.getByRole('button',{name:'Reset all 2 QRs',exact:true}).click();await expect(dialog).toHaveCount(0);
  expect(qrs.every(q=>q.qr_style===null)).toBe(true);expect(qrs.map(q=>q.storage_path)).toEqual(['first.png','second.png']);expect(bulkWrites).toEqual([{palette:'classic',shape:'dots',logo:false,colour:'pink'},null]);
  await openOptions();await page.getByRole('button',{name:'Customize QR',exact:true}).click();
  await expect(dialog.getByText('Scan check passed. Original data matches.')).toBeVisible({timeout:20000});brokenSecond=true;
  await dialog.getByRole('button',{name:'Apply this design to all QRs',exact:true}).click();
  await expect(dialog.getByText('Style Friend · Second bank',{exact:true})).toBeVisible({timeout:30000});
  await expect(dialog.getByRole('button',{name:'Apply to all 2 QRs',exact:true})).toBeDisabled();expect(bulkWrites).toHaveLength(2);

});

test('all preset combinations render to scannable SVG with unchanged data',async({page},info)=>{
  test.skip(info.project.name!=='desktop','Render matrix once; workflow is checked on both viewports.');
  test.setTimeout(120_000);
  const payload='0002010102115204000053034585802MY5912TEST ONLY6002KL6304ABCD';
  const source=await QRCode.toDataURL(payload,{width:420,margin:4});
  await page.goto('/?demo=1');
  const results=await page.evaluate(async source=>{
    const modulePath='/src/qr-format.ts';const {cleanQR,verifyQR}=await import(modulePath);
    const stylesPath='/src/qr-style.ts';const {QR_COLOURS}=await import(stylesPath);
    const image=new Image();image.src=source;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
    const frame=ctx.getImageData(0,0,canvas.width,canvas.height);
    const results=[];const previews:string[]=[];
    for(const palette of ['classic','payindex','midnight','cyber'])for(const colour of ['black','slate','navy','blue','pink','crimson','coral','amber','olive','forest','teal','ocean','indigo','violet','plum'])for(const shape of ['square','rounded','dots','classy'])for(const logo of [false,true]){
      const result=cleanQR({pixels:frame.data,width:frame.width,height:frame.height},{palette,shape,logo,colour});
      if(!result){results.push({palette,shape,logo,valid:false});continue;}
      if(!logo){
        const fills=[...result.svg.matchAll(/fill="([^"]+)"/g)].map(match=>match[1]);
        if(fills.some(fill=>fill!=='#fff'&&fill!==QR_COLOURS[colour].hex))throw new Error('Unexpected colour: '+palette+'/'+colour+'/'+shape);
      }
      if(colour==='pink'&&!logo)previews.push(`<div style="background:#151619;border:1px solid #333;border-radius:18px;padding:20px"><div style="background:#fff;border-radius:12px">${result.svg}</div><h2 style="text-align:center;font:600 20px system-ui;text-transform:capitalize;margin:18px 0 0">${palette} · ${shape}</h2></div>`);
      const url=URL.createObjectURL(new Blob([result.svg],{type:'image/svg+xml'}));
      try{
        const img=new Image();img.src=url;await img.decode();canvas.width=result.width;canvas.height=result.height;ctx.drawImage(img,0,0);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
        results.push({palette,shape,logo,valid:verifyQR({pixels:pixels.data,width:pixels.width,height:pixels.height},result.proof)});
      }finally{URL.revokeObjectURL(url);}
    }
    document.body.innerHTML=`<main style="max-width:1400px;margin:40px auto;padding:24px;color:#fff"><h1 style="font:600 30px system-ui;margin:0 0 28px">PayIndex · QR designs and shapes</h1><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px">${previews.join('')}</div></main>`;
    document.querySelectorAll('main svg').forEach(svg=>{svg.setAttribute('width','100%');svg.setAttribute('height','auto');});
    return results;
  },source);
  expect(results).toHaveLength(480);expect(results.filter(r=>!r.valid)).toEqual([]);
  await page.screenshot({path:'test-results/qr-shape-comparison.png',fullPage:true});
});
