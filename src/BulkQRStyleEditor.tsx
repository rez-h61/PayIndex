import { useEffect, useRef, useState } from 'react';
import type { QR } from './config';
import { ASSET_BUCKET } from './config';
import { manageDirectory, supabase } from './lib';
import type { QRStyle } from './qr-style';
import { useFormattedQR } from './useFormattedQR';

function QRCheck({qr,style,onResult}: {qr:QR;style:QRStyle;onResult:(passed:boolean)=>void}) {
  const [blob,setBlob]=useState<Blob|null>(null),[failed,setFailed]=useState(false);
  const reported=useRef(false);
  const {formatted,checking}=useFormattedQR(blob,style,false);
  useEffect(()=>{
    let cancelled=false;
    void supabase!.storage.from(ASSET_BUCKET).download(qr.storage_path).then(({data,error})=>{
      if(cancelled)return;if(error||!data)setFailed(true);else setBlob(data);
    }).catch(()=>{if(!cancelled)setFailed(true);});
    return()=>{cancelled=true;};
  },[qr.storage_path]);
  useEffect(()=>{
    if(reported.current||(!failed&&(!blob||checking)))return;
    reported.current=true;onResult(!failed&&!!formatted);
  },[failed,blob,checking,formatted,onResult]);
  return <p className="footnote" role="status">Checking {qr.label}…</p>;
}

export function BulkQRStyleEditor({qrs,design,labelFor,onBack,onClose,onBusy,onSaved}: {
  qrs:QR[];design:QRStyle|null;labelFor:(qr:QR)=>string;onBack:()=>void;onClose:()=>void;
  onBusy:(busy:boolean)=>void;onSaved:(reset:boolean,count:number)=>Promise<void>;
}) {
  // Freeze the reviewed directory snapshot; any concurrent change is rejected atomically.
  const [snapshot]=useState(qrs);
  const [results,setResults]=useState<boolean[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const reset=design===null, checking=!reset&&snapshot.length<=5000&&results.length<snapshot.length;
  const failures=snapshot.filter((_,index)=>results[index]===false);
  const canSave=snapshot.length>0&&snapshot.length<=5000&&!checking&&!failures.length;
  async function save() {
    if(busy||!canSave)return;setBusy(true);onBusy(true);setError('');
    try {
      const form=new FormData();form.set('action','bulk_qr_style');form.set('qr_style',JSON.stringify(design));
      form.set('snapshot',JSON.stringify(snapshot.map(q=>({id:q.id,updated_at:q.updated_at}))));
      await manageDirectory(form);await onSaved(reset,snapshot.length);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}
  }
  return <div className="form qr-bulk-review">
    <h3>{reset?'Reset all QRs?':'Apply this design to all QRs?'}</h3>
    <p className="muted">{reset?`All ${snapshot.length} QRs will return to the standard black-and-white Clean QR, without custom shapes or logos.`:`This will replace the colour, shape and logo settings on all ${snapshot.length} QRs in the directory.`} Original uploaded images are preserved.</p>
    {!reset&&<><progress max={Math.max(snapshot.length,1)} value={results.length}/><p role="status">{results.length} of {snapshot.length} checked · {results.filter(Boolean).length} verified</p></>}
    {checking&&design&&<QRCheck key={snapshot[results.length].id} qr={snapshot[results.length]} style={design} onResult={passed=>setResults(current=>[...current,passed])}/>}
    {!!failures.length&&<div className="error" role="alert"><p>These QRs could not be verified with this design. No QRs have been changed. Go back and choose another design.</p><ul>{failures.map(q=><li key={q.id}>{labelFor(q)}</li>)}</ul></div>}
    {!checking&&!reset&&!failures.length&&!!snapshot.length&&<p className="qr-style-verification">All QRs passed the scan check.</p>}
    {!snapshot.length&&<p>No QRs are available.</p>}
    {snapshot.length>5000&&<p role="alert">Bulk changes currently support up to 5,000 QRs.</p>}
    {error&&<div className="error" role="alert">{error}</div>}
    <div className="form-actions"><button type="button" onClick={onBack} disabled={busy}>Back</button><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="primary" disabled={busy||!canSave} onClick={()=>void save()}>{busy?'Saving…':reset?`Reset all ${snapshot.length} QRs`:`Apply to all ${snapshot.length} QRs`}</button></div>
  </div>;
}
