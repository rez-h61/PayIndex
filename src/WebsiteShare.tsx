import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { ArrowDownToLine, Copy, QrCode } from 'lucide-react';
import { manageDirectory, supabase } from './lib';
import { useFormattedQR } from './useFormattedQR';
import type { QRStyle } from './qr-style';

const SHARE_STYLE: QRStyle = {palette:'payindex',colour:'black',shape:'rounded',logo:true};
export function WebsiteShare({admin,demo}: {admin:boolean;demo:boolean}) {
  const [settings,setSettings]=useState<{share_url:string;updated_at:string}|null>(null);
  const [shown,setShown]=useState(false),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [source,setSource]=useState<{link:string;blob:Blob}|null>(null);
  const blob=source?.link===settings?.share_url?source?.blob??null:null;
  const {formatted,checking}=useFormattedQR(blob,SHARE_STYLE,false);
  useEffect(()=>{
    let cancelled=false;
    if(demo||!supabase){setSettings({share_url:location.origin,updated_at:''});return;}
    void supabase.from('directory_settings').select('share_url,updated_at').eq('id',true).single().then(({data,error})=>{
      if(cancelled)return;
      if(error||!data)setError('The website share link could not load. Close this window and try again.');
      else {setSettings(data);setDraft(data.share_url);}
    });
    return()=>{cancelled=true;};
  },[demo]);
  useEffect(()=>{
    let cancelled=false;
    if(!shown||!settings)return;
    const canvas=document.createElement('canvas');
    void QRCode.toCanvas(canvas,settings.share_url,{width:800,margin:4,errorCorrectionLevel:'H'}).then(()=>{
      canvas.toBlob(value=>{if(!cancelled){if(value)setSource({link:settings.share_url,blob:value});else setError('The share QR could not be generated.');}},'image/png');
    }).catch(()=>{if(!cancelled)setError('The share QR could not be generated.');});
    return()=>{cancelled=true;};
  },[shown,settings]);
  async function save(event:FormEvent) {
    event.preventDefault();if(!settings||busy)return;setError('');setMessage('');
    let url:URL;
    try {url=new URL(draft.trim());if(url.protocol!=='https:'||url.username||url.password||url.href.length>2048)throw new Error();}
    catch {setError('Enter a valid HTTPS website link without a username or password.');return;}
    try {QRCode.create(url.href,{errorCorrectionLevel:'H'});}catch{setError('This link is too long for the share QR. Use a shorter website link.');return;}
    setBusy(true);
    try {
      const form=new FormData();form.set('action','save_share_url');form.set('share_url',url.href);form.set('expected_updated_at',settings.updated_at);
      await manageDirectory(form);
      const {data,error}=await supabase!.from('directory_settings').select('share_url,updated_at').eq('id',true).single();
      if(error||!data)throw new Error('Link saved. Close and reopen this window to load it.');
      setSettings(data);setDraft(data.share_url);setMessage('Website share link saved.');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="form website-share">
    <button type="button" disabled={!settings} onClick={()=>setShown(value=>!value)}><QrCode size={16}/>{shown?'Hide PayIndex QR':'Share PayIndex QR'}</button>
    {shown&&<><div className="qr-style-preview">{formatted?<img src={formatted.url} alt="PayIndex website share QR"/>:<p role="status">{!blob||checking?'Preparing website QR…':'The share QR could not be verified. Close and reopen this window to retry.'}</p>}</div><p className="footnote">Scan to open PayIndex.</p>{formatted&&<button type="button" className="primary full" onClick={()=>{const link=document.createElement('a');link.href=formatted.pngURL;link.download='payindex-website-qr.png';link.click();}}><ArrowDownToLine size={18}/>Download QR</button>}</>}
    <button type="button" className="text-button" disabled={!settings} onClick={async()=>{try{await navigator.clipboard.writeText(settings!.share_url);setMessage('Directory link copied.');}catch{setError('Copy is unavailable in this browser. Download or scan the QR instead.');setShown(true);}}}><Copy size={16}/>Copy directory link</button>
    {admin&&!demo&&<details><summary>Edit share link</summary><form className="form" onSubmit={save}><label>Website link<input type="url" required maxLength={2048} value={draft} disabled={busy||!settings} onChange={event=>setDraft(event.target.value)}/></label><p className="footnote">This changes the shared link for everyone. The QR design is fixed.</p><button className="primary" disabled={busy||!settings}>{busy?'Saving…':'Save share link'}</button></form></details>}
    {message&&<p role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </div>;
}
