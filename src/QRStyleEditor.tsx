import { useState, type FormEvent } from 'react';
import type { QR } from './config';
import { manageDirectory } from './lib';
import { DEFAULT_QR_STYLE, QR_PALETTES, QR_SHAPES, type QRStyle } from './qr-style';
import { useFormattedQR } from './useFormattedQR';

export function QRStyleEditor({ qr, blob, loadError, onClose, onBusy, onSaved, onBulk, initialStyle }: {
  qr: QR; blob: Blob | null; loadError: boolean; onClose: () => void;
  onBusy: (busy: boolean) => void; onSaved: () => Promise<void>; onBulk: (design: QRStyle|null, draft:QRStyle|null) => void; initialStyle?:QRStyle|null;
}) {
  const [style,setStyle]=useState<QRStyle|null>(initialStyle===undefined?qr.qr_style??null:initialStyle);
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const {formatted,checking,failure,retry}=useFormattedQR(blob,style,false);
  const failureMessage = failure === 'worker' ? 'The QR processor could not start. Refresh the page or retry the preview.'
    : failure === 'timeout' ? 'QR processing timed out. Retry the preview.'
    : failure === 'render' ? 'The browser could not render this QR. Retry the preview.'
    : failure === 'verification' ? 'This design failed the scan check. Try another shape or turn off the logo.'
    : failure === 'source' ? 'The original image could not be decoded. Retry or upload a clearer image.'
    : 'The original QR could not be regenerated safely. Retry the preview or use a clearer original.';
  const selected=style??DEFAULT_QR_STYLE;
  const change=(patch:Partial<QRStyle>)=>{setError('');setStyle({...selected,...patch});};
  async function save(event:FormEvent) {
    event.preventDefault(); if(busy||checking||!formatted)return;
    setBusy(true);onBusy(true);setError('');
    try {
      const form=new FormData();form.set('action','save_qr_style');form.set('id',qr.id);
      form.set('qr_style',JSON.stringify(style));form.set('expected_updated_at',qr.updated_at);
      await manageDirectory(form);await onSaved();
    } catch(e){setError((e as Error).message);}
    finally{setBusy(false);onBusy(false);}
  }
  return <form className="form qr-style-form" onSubmit={save}>
    <p className="muted">{qr.label} · This design applies to this QR only.</p>
    <div className="qr-style-preview">{formatted?<img src={formatted.url} alt="Custom QR preview"/>:<p role="status">{loadError?'The original QR could not load.':checking||!blob?'Verifying QR preview…':failureMessage}</p>}</div>
    {!formatted&&!checking&&!!blob&&<button type="button" onClick={retry} disabled={busy}>Retry preview</button>}
    <p className="qr-style-verification" role="status">{formatted?'Scan check passed. Original data matches.':checking?'Checking colours, shapes and logo…':''}</p>
    <fieldset disabled={busy}><legend>Colour <span className="muted">(15 options)</span></legend><div className="qr-style-choices qr-colour-choices">{Object.entries(QR_PALETTES).map(([key,palette])=><label className={selected.palette===key?'selected':''} key={key}>
      <input type="radio" name="qr-palette" value={key} checked={selected.palette===key} onChange={()=>change({palette:key as QRStyle['palette']})}/><span className="qr-swatch" style={{background:palette.eye}}/>{palette.name}
    </label>)}</div></fieldset>
    <fieldset disabled={busy}><legend>Module shape</legend><div className="qr-style-choices">{QR_SHAPES.map(shape=><label className={selected.shape===shape?'selected':''} key={shape}>
      <input type="radio" name="qr-shape" value={shape} checked={selected.shape===shape} onChange={()=>change({shape})}/>{shape[0].toUpperCase()+shape.slice(1)}
    </label>)}</div></fieldset>
    <label className="checkbox"><input type="checkbox" checked={selected.logo} disabled={busy} onChange={event=>change({logo:event.target.checked})}/><span>Embed PayIndex logo</span></label>
    <button type="button" className="text-button" disabled={busy} onClick={()=>{setStyle(null);setError('');}}>Reset to default Clean QR</button>
    <p className="footnote">Preview and downloads use the same verified design. Test it with your banking app before sharing.</p>
    <fieldset className="qr-bulk-actions" disabled={busy}><legend>All QRs in the directory</legend><button type="button" disabled={checking||!formatted} onClick={()=>onBulk(selected,style)}>Apply this design to all QRs</button><button type="button" onClick={()=>onBulk(null,style)}>Reset all QRs to default</button></fieldset>
    {error&&<div className="error" role="alert">{error}</div>}
    <div className="form-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy||checking||!formatted}>{busy?'Saving…':'Save design'}</button></div>
  </form>;
}
