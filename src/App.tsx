import { useFormattedQR } from './useFormattedQR';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, Copy, ImagePlus, Link as LinkIcon, LockKeyhole, LogOut, Pencil, Plus, QrCode, Search, ShieldCheck, Trash2, Upload, Users, WifiOff, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { APP_NAME, ASSET_BUCKET, PROVIDERS, validName, validLabel, validDuitNowAccount, validImageURL, type Person, type QR } from './config';
import { supabase, configured, objectURL, releaseURL, clearURLs, validateImage, manageDirectory, imageFromLink } from './lib';
import { demoPeople, demoQRs } from './demo';

const formatDate = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
const initials = (value: string) => value.trim().split(/\s+/).slice(0,2).map(v => v[0]).join('').toUpperCase();
function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const change = () => setPath(location.pathname); window.addEventListener('popstate', change); return () => window.removeEventListener('popstate', change); }, []);
  const navigate = (next: string) => { history.pushState(null, '', next + location.search); setPath(next); window.scrollTo(0,0); };
  return [path, navigate] as const;
}
function useStoredImage(path: string | null, retry = 0) {
  const [value, setValue] = useState<{ url: string; blob: Blob } | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    setValue(null); setFailed(false); if (!path || !supabase) return;
    let cancelled = false, url = '';
    void supabase.storage.from(ASSET_BUCKET).download(path).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) { setFailed(true); return; }
      url = objectURL(data); setValue({ url, blob: data });
    });
    return () => { cancelled = true; if (url) releaseURL(url); };
  }, [path, retry]);
  return { value, failed };
}
function Avatar({ person, large = false }: { person: Person; large?: boolean }) {
  const { value } = useStoredImage(person.avatar_path);
  const [failed, setFailed] = useState(false);
  const url = value?.url ?? person.avatar_url;
  useEffect(() => setFailed(false), [url]);
  return <span className={`avatar ${large ? 'large' : ''}`}>{url && !failed ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : initials(person.display_name)}</span>;
}
function ErrorBox({ message, retry }: { message: string; retry?: () => void }) { return <div role="alert" className="error"><p>{message}</p>{retry && <button className="text-button" onClick={retry}>Try again <ArrowRight size={15}/></button>}</div>; }
function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><span className="empty-icon"><Users size={24}/></span><h2>{title}</h2>{children && <p>{children}</p>}</div>; }
function Back({ onClick, children = 'Directory' }: { onClick: () => void; children?: ReactNode }) { return <button className="back" onClick={onClick}><ArrowLeft size={16}/>{children}</button>; }
function Modal({ title, onClose, locked, children }: { title: string; onClose: () => void; locked?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.showModal(); return () => previous?.focus(); }, []);
  return <dialog ref={ref} aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); if (!locked) onClose(); }}><div className="dialog-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close" disabled={locked} onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}

export default function App() {
  const [path, navigate] = usePath();
  const demo = (import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === 'true') && new URLSearchParams(location.search).get('demo') === '1';
  const [people, setPeople] = useState<Person[]>(demo ? demoPeople : []), [qrs, setQRs] = useState<QR[]>(demo ? demoQRs : []);
  const [admin, setAdmin] = useState(false), [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(!demo && configured), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine), [search, setSearch] = useState('');
  const [help, setHelp] = useState(false), [editor, setEditor] = useState<QR | 'new' | null>(null), [busy, setBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const generation = useRef(0), authGeneration = useRef(0), adminRef = useRef(admin); adminRef.current = admin;
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const clear = useCallback(() => { generation.current++; clearURLs(); setPeople([]); setQRs([]); setEditor(null); setSearch(''); }, []);
  const refresh = useCallback(async (full = false) => {
    if (demo || !configured || !navigator.onLine) return;
    const run = ++generation.current; if (full) setLoading(true);
    try {
      const [persons, codes] = await Promise.all([supabase!.from('directory_people').select('*').order('display_name'), supabase!.from('directory_qrs').select('*').order('label')]);
      if (persons.error || codes.error) throw new Error();
      if (run !== generation.current) return;
      setPeople((persons.data ?? []).sort((a,b) => a.display_name.localeCompare(b.display_name))); setQRs(codes.data ?? []); setError('');
    } catch { if (run === generation.current) { clearURLs(); setPeople([]); setQRs([]); setError('The directory couldn’t load. Try again in a moment. If this is a new installation, finish the database setup first.'); } }
    finally { if (run === generation.current) setLoading(false); }
  }, [demo]);
  const checkAdmin = useCallback(async () => {
    if (!supabase || demo) { setAuthChecked(true); return; }
    const run = ++authGeneration.current;
    const { data: { session } } = await supabase.auth.getSession();
    if (run !== authGeneration.current) return;
    if (!session) { setAdmin(false); setEditor(null); setAuthChecked(true); return; }
    const { data, error } = await supabase.rpc('is_directory_admin');
    if (run !== authGeneration.current) return;
    const allowed = !error && data === true;
    if (!allowed && adminRef.current) { clear(); setNotice('Admin access has ended. Sign in again to make changes.'); }
    setAdmin(allowed); setAuthChecked(true);
  }, [clear, demo]);
  useEffect(() => {
    if (demo) { setAuthChecked(true); return; }
    void checkAdmin().then(() => refresh(true));
    const subscription = supabase?.auth.onAuthStateChange(() => { window.setTimeout(() => { void checkAdmin().then(() => refresh()); }, 0); }).data.subscription;
    return () => subscription?.unsubscribe();
  }, [checkAdmin, refresh, demo]);
  useEffect(() => {
    const offline = () => { setOnline(false); clear(); };
    const check = () => { setOnline(navigator.onLine); if (document.visibilityState === 'visible' && navigator.onLine) { if (demo) { setPeople(demoPeople); setQRs(demoQRs); } else void checkAdmin().then(() => refresh()); } };
    const install = (event: Event) => { event.preventDefault(); setInstallPrompt(event as Event & { prompt: () => Promise<void> }); };
    window.addEventListener('offline', offline); window.addEventListener('online', check); window.addEventListener('focus', check); document.addEventListener('visibilitychange', check); window.addEventListener('beforeinstallprompt', install);
    const interval = window.setInterval(check, 45_000);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', check); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); window.removeEventListener('beforeinstallprompt', install); clearInterval(interval); };
  }, [checkAdmin, refresh, clear, demo]);
  const previousPath = useRef(path);
  useEffect(() => { setNotice(''); setEditor(null); if (previousPath.current !== path) document.querySelector<HTMLElement>('h1')?.focus(); previousPath.current = path; }, [path]);
  const personId = path.match(/^\/(?:people|admin\/people)\/([^/]+)$/)?.[1];
  const selectedQR = path.startsWith('/qr/') ? qrs.find(q => q.id === path.slice(4)) : undefined;
  const person = people.find(p => p.id === (selectedQR?.person_id ?? personId));
  const isAdminPage = path.startsWith('/admin');
  const isEditingPerson = isAdminPage && !!personId;
  const canPreview = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === 'true';
  async function signOut() { setAdmin(false); clear(); navigate('/'); const result = await supabase?.auth.signOut({scope:'local'}); if (result?.error) setError('Sign-out could not finish. Reconnect and try again.'); await refresh(true); }
  async function remove(kind: 'person' | 'qr', id: string, name: string, updated: string) {
    if (!confirm(kind === 'person' ? `Delete ${name} and all their QR entries? Previously saved images cannot be recalled.` : `Delete ${name}? Previously saved images cannot be recalled.`)) return;
    setBusy(true); setError('');
    try { const form = new FormData(); form.set('action', `delete_${kind}`); form.set('id',id); form.set('expected_updated_at',updated); const result = await manageDirectory(form); if (kind === 'person') navigate('/admin'); await refresh(); setNotice(result.cleanupPending ? 'Removed. File cleanup is queued for retry.' : 'Removed from the directory.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const startPreview = () => { location.href = '/?demo=1'; };
  return <div className="app">
    <a href="#main" className="skip">Skip to content</a>
    <header className="topbar"><button className="wordmark" onClick={() => navigate('/')} aria-label={`${APP_NAME} home`}><span className="brand-mark"><i/><i/><i/></span>{APP_NAME}</button><div className="header-actions"><button className="nav-link" onClick={() => navigate(admin ? '/admin' : '/admin/login')}>{admin ? 'Manage directory' : <><LockKeyhole size={14}/>Admin</>}</button><button className="icon-button" onClick={() => setHelp(true)} aria-label="Install and help"><CircleHelp size={18}/></button></div></header>
    {demo && <div className="demo-banner"><span>DESIGN PREVIEW</span> Fictional people · no real payment QRs <a href="/">Exit preview</a></div>}
    {needRefresh && <div className="update-banner">An update is ready.<button disabled={busy || !!editor || isEditingPerson} onClick={() => void updateServiceWorker(true)}>Update now</button></div>}
    <main id="main" className={isAdminPage ? 'main admin-main' : 'main'}>
      {!online ? <section className="state"><WifiOff size={30}/><h1 tabIndex={-1}>A connection, please.</h1><p>Connect to load the latest people and QRs. Directory content isn’t kept offline.</p><button onClick={() => { setOnline(navigator.onLine); void refresh(true); }}>Try again</button></section>
      : isAdminPage && (!admin || demo) ? <AdminLogin checked={authChecked} demo={demo} onBack={() => navigate('/')} onSuccess={async () => { await checkAdmin(); await refresh(true); navigate('/admin'); }}/>
      : loading ? <section className="state" role="status"><span className="spinner"/><p>Opening the directory…</p></section>
      : <div key={path} className="page-enter">
        {error && <ErrorBox message={error} retry={() => void refresh(true)}/>}{notice && <p className="notice" role="status"><Check size={16}/>{notice}</p>}
        {path === '/' || path === '/admin' ? <>
          <div className="page-heading"><div><p className="eyebrow">{admin && path === '/admin' ? 'YOUR DIRECTORY' : 'LESS ASKING. MORE LIVING.'}</p><h1 tabIndex={-1}>{path === '/admin' ? 'Keep your people close.' : 'Find your people.'}</h1><p className="muted">{path === '/admin' ? 'Add a friend. Give their QRs a home.' : 'Their receiving QRs. One easy place.'}</p></div>{path === '/admin' && <button className="primary" onClick={() => navigate('/admin/people/new')}><Plus size={17}/>Add person</button>}</div>
          {!configured && !demo ? <div className="setup-note"><p>The directory is almost ready. Connect Supabase to add your people.</p>{canPreview && <button onClick={startPreview}>Explore design preview <ArrowRight size={16}/></button>}</div> : error ? null : <>
          <section className="directory-panel" aria-label="People directory"><label className="search"><Search size={19}/><span className="sr-only">Search people</span><input type="search" placeholder="Who are you looking for?" value={search} onChange={e => setSearch(e.target.value)}/><span className="keycap" aria-hidden="true">⌕</span></label><div className="list-meta"><span>YOUR PEOPLE</span><span>{people.length.toString().padStart(2,'0')}</span></div>
          <div className="member-list">{people.filter(p => p.display_name.toLowerCase().includes(search.toLowerCase())).map((p,i) => <button className="member-row" key={p.id} onClick={() => navigate(`/people/${p.id}`)}><span className="row-number">{(i+1).toString().padStart(2,'0')}</span><Avatar person={p}/><span className="person-name">{p.display_name}<small>{qrs.filter(q => q.person_id === p.id).length} payment {qrs.filter(q => q.person_id === p.id).length === 1 ? 'option' : 'options'}</small></span><span className="row-open"><ChevronRight size={18}/></span></button>)}</div>
          {!people.length ? <Empty title="A place for your people.">{admin ? 'Add your first person to get started.' : 'The admin hasn’t added anyone yet.'}</Empty> : !people.some(p => p.display_name.toLowerCase().includes(search.toLowerCase())) && <Empty title="No one by that name.">Try a different name.</Empty>}
          </section><p className="quiet-note"><ShieldCheck size={14}/>Receiving QRs only. Always check the recipient.</p></>}
          {configured && !demo && error && canPreview && <button className="text-button" onClick={startPreview}>Explore design preview <ArrowRight size={16}/></button>}
          {path === '/admin' && <div className="admin-footer"><span>Only you can make changes.</span><button className="text-button" onClick={() => void signOut()}><LogOut size={15}/>Sign out</button></div>}
        </> : isEditingPerson ? <><Back onClick={() => navigate(person ? `/people/${person.id}` : '/admin')}/>{personId === 'new' || person ? <PersonEditor key={personId} person={person} onBusy={setBusy} onSaved={async (id, pending) => { await refresh(); navigate(`/people/${id}`); setNotice(pending ? 'Saved. Old file cleanup is queued.' : 'Person saved.'); }}/> : <Empty title="This person is no longer here."/>}</>
        : path.startsWith('/people/') ? <><Back onClick={() => navigate(admin ? '/admin' : '/')}/>{person ? <><div className="person-heading"><Avatar person={person} large/><p className="eyebrow">PAYMENT OPTIONS</p><h1 tabIndex={-1}>{person.display_name}</h1><p className="muted">Pick a place to send.</p></div>{admin && <div className="person-tools"><button onClick={() => navigate(`/admin/people/${person.id}`)}><Pencil size={15}/>Edit person</button><button className="primary" onClick={() => setEditor('new')}><Plus size={16}/>Add QR</button></div>}<div className="provider-list">{qrs.filter(q => q.person_id === person.id).map(q => <div className="provider-wrap" key={q.id}><button className="provider-row" onClick={() => navigate(`/qr/${q.id}`)}><span className="provider-symbol"><QrCode size={20}/></span><span><strong>{q.label}</strong><small>Updated {formatDate(q.updated_at)}</small></span><ChevronRight size={18}/></button>{admin && <div className="row-actions"><button onClick={() => setEditor(q)} disabled={busy}>Edit</button><button disabled={busy} onClick={() => void remove('qr',q.id,q.label,q.updated_at)}>Delete</button></div>}</div>)}</div>{!qrs.some(q => q.person_id === person.id) && <Empty title="No QRs just yet.">{admin ? 'Add a receiving QR for this person.' : 'Check back when the admin has added one.'}</Empty>}<p className="footnote">Provider labels don’t guarantee compatibility with every payment app.</p>{admin && <button className="text-button danger" disabled={busy} onClick={() => void remove('person',person.id,person.display_name,person.updated_at)}><Trash2 size={15}/>Delete person</button>}</> : <Empty title="This person is no longer here.">Return to the directory to find someone else.</Empty>}</>
        : path.startsWith('/qr/') ? <><Back onClick={() => navigate(person ? `/people/${person.id}` : '/')}>{person?.display_name ?? 'Directory'}</Back>{selectedQR && person ? <Viewer key={selectedQR.storage_path || selectedQR.id} qr={selectedQR} person={person} demo={demo}/> : <Empty title="This QR is no longer here.">It may have been replaced or removed.</Empty>}</>
        : <><Back onClick={() => navigate('/')}/><Empty title="Page not found.">Head back to your people.</Empty></>}
      </div>}
    </main><footer className="footer"><span>Made for the people you know.</span><span className="footer-mark">PAYINDEX <i/> RECEIVING ONLY</span></footer>
    {editor && person && admin && <QREditor person={person} existing={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onBusy={setBusy} onSaved={async pending => { setEditor(null); await refresh(); setNotice(pending ? 'QR saved. Old file cleanup is queued.' : 'QR saved.'); }}/>} 
    {help && <Modal title="A little closer." onClose={() => setHelp(false)}><p className="muted">Keep PayIndex on your home screen.</p>{installPrompt && <button className="primary" onClick={async () => { await installPrompt.prompt(); setInstallPrompt(null); }}>Install PayIndex</button>}<ul className="help-list"><li><strong>iPhone / iPad</strong><span>Safari → Share → Add to Home Screen.</span></li><li><strong>Android / desktop</strong><span>Use Install app in your browser’s menu.</span></li></ul><p className="footnote">Anyone with the link can view this directory. A connection is needed to load QRs. Only the admin can edit.</p><button className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(location.origin); setNotice('Directory link copied.'); setHelp(false); } catch { setNotice('Copy the website address from your browser.'); setHelp(false); } }}><Copy size={16}/>Copy directory link</button></Modal>}
  </div>;
}

function AdminLogin({ checked, demo, onBack, onSuccess }: { checked: boolean; demo: boolean; onBack: () => void; onSuccess: () => Promise<void> }) {
  const [email,setEmail] = useState(''), [password,setPassword] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy || !supabase || demo) return; setBusy(true); setError('');
    try {
      const result = await supabase.auth.signInWithPassword({email:email.trim(),password});
      if (result.error) throw new Error('Email or password wasn’t accepted. Please try again.');
      const access = await supabase.rpc('is_directory_admin');
      if (access.error || access.data !== true) { await supabase.auth.signOut({scope:'local'}); throw new Error('This account isn’t the directory admin. Check the admin setup.'); }
      setPassword(''); await onSuccess();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <><Back onClick={onBack}/><section className="login-panel"><span className="login-icon"><LockKeyhole size={23}/></span><p className="eyebrow">JUST FOR THE ADMIN</p><h1 tabIndex={-1}>Welcome back.</h1><p className="muted">A quiet place to keep things up to date.</p><form className="form" onSubmit={submit}><label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} disabled={busy}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/></label>{error && <ErrorBox message={error}/>}<button className="primary full" disabled={busy || !configured || demo || !checked}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={16}/></button></form><p className="footnote">{demo ? 'Login is disabled in this design preview.' : !configured ? 'Connect Supabase to enable admin sign-in.' : 'Friends can browse without an account.'}</p></section></>;
}
function Viewer({qr, person, demo}: {qr:QR;person:Person;demo:boolean}) {
  const [retry,setRetry] = useState(0), {value:image,failed} = useStoredImage(demo ? null : qr.storage_path,retry);
  const [error,setError] = useState(false), [hint,setHint] = useState(''), [saving,setSaving] = useState(false);
  const {formatted,checking}=useFormattedQR(image?.blob??null);
  const [showOriginal,setShowOriginal]=useState(false);
  async function save(useFormatted = false) {
    if (!image) return; setSaving(true); setHint('');
    const file = new File([useFormatted&&formatted?formatted.blob:image.blob],`${person.display_name.replace(/[^\p{L}\p{N}_-]/gu,'-')}-${qr.label_key}.${useFormatted&&formatted?'png':qr.storage_path.split('.').pop()}`,{type:useFormatted&&formatted?'image/png':image.blob.type});
    try { if (/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.canShare?.({files:[file]})) { await navigator.share({files:[file],title:`${person.display_name} · ${qr.label}`}); setHint('Choose Save Image or Save to Files from the share sheet.'); } else { const a=document.createElement('a'); a.href=useFormatted&&formatted?formatted.url:image.url; a.download=file.name; a.click(); setHint('If no download appears, open the original below and use Save Image or Share → Save to Files.'); } }
    catch(e) { if ((e as Error).name !== 'AbortError') setHint('Open the original below and use Save Image or Share → Save to Files.'); } finally { setSaving(false); }
  }
  return <section className="viewer"><p className="eyebrow">RECEIVING QR</p><h1 tabIndex={-1}>{person.display_name}</h1><p className="viewer-label">{qr.label}</p><div className="qr-stage">{demo ? <div className="demo-placeholder"><QrCode size={48}/><strong>QR preview</strong><span>No payment QR in demo mode</span></div> : failed || error ? <ErrorBox message="This QR couldn’t load. It may have been replaced." retry={() => {setError(false);setRetry(v=>v+1);}}/> : image ? <img src={!showOriginal&&formatted?formatted.url:image.url} alt={`${person.display_name}’s ${qr.label} receiving QR`} onError={()=>setError(true)}/> : <p role="status">Loading original image…</p>}</div>{image&&<div className="qr-format-controls">{checking?<p className="footnote" role="status">Finding the QR and preparing a clean view…</p>:formatted?<><p className="footnote">Auto-formatted with white space for scanning.</p><button type="button" className="text-button" onClick={()=>setShowOriginal(v=>!v)}>{showOriginal?'Show formatted QR':'Show original QR'}</button><button type="button" onClick={()=>void save(true)} disabled={saving}>Save formatted QR</button></>:<p className="footnote">Showing the original image. A clean QR crop could not be verified.</p>}</div>}<p className="updated">UPDATED {formatDate(qr.updated_at).toUpperCase()}</p><button className="primary full" onClick={() => void save()} disabled={!image || saving || error}><ArrowDownToLine size={18}/>{saving ? 'Saving…' : 'Save QR'}</button>{hint && <p className="footnote" role="status">{hint}</p>}{image && <a className="original-link" href={image.url} target="_blank" rel="noreferrer">Open original image</a>}<DuitNowAccount account={qr.duitnow_account}/><p className="recipient-note"><ShieldCheck size={18}/><span>Check the recipient name in your banking app before confirming.</span></p><p className="footnote">Added by the admin. QR ownership isn’t verified.</p></section>;
}

function DuitNowAccount({account}: {account?: string | null}) {
  const [message,setMessage]=useState('');
  if (!account) return null;
  return <div className="duitnow-account"><p className="eyebrow">TRANSFER ONLY</p><p className="muted">Account number</p><strong className="account-number">{account}</strong><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(account);setMessage('Account number copied.');}catch{setMessage('Select and copy the account number above.');}}}><Copy size={16}/>Copy account number</button>{message&&<p className="footnote" role="status">{message}</p>}<p className="footnote">Use this number for a manual transfer in your banking app.</p></div>;
}

function useImageSelection() {
  const [file,setFile] = useState<File|null>(null), [preview,setPreview] = useState(''), [error,setError] = useState(''), [checking,setChecking] = useState(false);
  const version=useRef(0);
  useEffect(()=> { if (!file) {setPreview('');return;} const u=objectURL(file);setPreview(u);return()=>releaseURL(u);},[file]);
  async function choose(next?:File) { const current=++version.current;setFile(null);setError('');if(!next)return;setChecking(true);try{await validateImage(next);if(current===version.current)setFile(next);}catch(e){if(current===version.current)setError((e as Error).message);}finally{if(current===version.current)setChecking(false);} }
  return {file,preview,error,checking,choose};
}
function PersonEditor({person,onSaved,onBusy}: {person?:Person;onSaved:(id:string,pending:boolean)=>Promise<void>;onBusy:(value:boolean)=>void}) {
  const [name,setName]=useState(person?.display_name??''),[mode,setMode]=useState<'upload'|'link'|'none'>(person?.avatar_url?'link':person?.avatar_path?'upload':'none'),[url,setURL]=useState(person?.avatar_url??''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0);
  const image=useImageSelection(),id=useRef(person?.id??crypto.randomUUID());
  async function submit(e:FormEvent){e.preventDefault();if(busy)return;if(!validName(name)){setError('Use a name of 1–60 characters.');return;}if(mode==='link'&&!validImageURL(url)){setError('Use a direct image link starting with https://.');return;}if(mode==='upload'&&!image.file&&!person?.avatar_path){setError('Choose a photo, or select No photo.');return;}
    setBusy(true);onBusy(true);setError('');const form=new FormData();form.set('action','save_person');form.set('id',id.current);form.set('display_name',name.trim());form.set('avatar_mode',mode);form.set('avatar_url',url.trim());if(person)form.set('expected_updated_at',person.updated_at);if(mode==='upload'&&image.file)form.set('file',image.file);
    try{const result=await manageDirectory(form,setProgress);await onSaved(id.current,!!result.cleanupPending);}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}
  }
  return <section className="editor-page"><p className="eyebrow">{person?'EDIT PERSON':'ADD SOMEONE'}</p><h1 tabIndex={-1}>{person?'The familiar details.':'One more friend.'}</h1><form className="form panel-form" onSubmit={submit}><label>Name<input required maxLength={60} value={name} onChange={e=>setName(e.target.value)} disabled={busy} placeholder="Their display name" autoComplete="off"/></label><fieldset disabled={busy}><legend>Photo <span className="muted">(optional)</span></legend><div className="segmented">{([{key:'none',label:'No photo',icon:Users},{key:'upload',label:'Upload',icon:Upload},{key:'link',label:'Image link',icon:LinkIcon}] as const).map(item=><label key={item.key} className={mode===item.key?'selected':''}><input type="radio" name="photo-mode" value={item.key} checked={mode===item.key} onChange={()=>setMode(item.key)}/><item.icon size={15}/>{item.label}</label>)}</div></fieldset>{mode==='upload'&&<><label className="file-field"><ImagePlus size={22}/><span>{person?.avatar_path&&!image.file?'Keep current photo or choose a replacement':'Choose a photo'}</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>void image.choose(e.target.files?.[0])}/><small>PNG, JPEG or WebP · up to 5 MB</small></label>{image.preview&&<img className="avatar-preview" src={image.preview} alt="Selected profile photo"/>}</>}{mode==='link'&&<label>Direct image URL<input type="url" aria-label="Direct image URL" aria-describedby="photo-link-help" value={url} onChange={e=>setURL(e.target.value)} placeholder="https://example.com/photo.jpg" required disabled={busy}/><small id="photo-link-help" className="muted">Use a direct image URL, not a page or sharing link. If it stops working, initials are shown.</small></label>}{mode==='none'&&<div className="initials-preview"><span className="avatar">{initials(name||'A')}</span><span>Initials keep it simple.</span></div>}{image.checking&&<p role="status">Checking photo…</p>}{(error||image.error)&&<ErrorBox message={error||image.error}/>}<Progress busy={busy} progress={progress}/><button className="primary" disabled={busy||image.checking}>{busy?'Saving…':'Save person'}<ArrowRight size={16}/></button></form></section>;
}
function Progress({busy,progress}:{busy:boolean;progress:number}) {return busy?<div role="status"><progress max={100} value={progress}/><p className="footnote">{progress<95?`Uploading… ${progress}%`:'Finishing up…'}</p></div>:null;}
function ImageLinkImport({ disabled, onLoaded }: { disabled: boolean; onLoaded: (file?: File) => Promise<void> }) {
  const [url,setURL]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load() { if(busy)return;setBusy(true);setError('');await onLoaded();try{await onLoaded(await imageFromLink(url.trim()));}catch(e){setError((e as Error).message);}finally{setBusy(false);} }
  return <details className="link-import"><summary><LinkIcon size={14}/>Or use an image link</summary><div><label>Direct QR image URL<input inputMode="url" value={url} onChange={e=>setURL(e.target.value)} placeholder="https://example.com/qr.png" disabled={disabled||busy}/></label><p className="footnote">Load the original image from a link, then save it with this QR.</p><button type="button" disabled={disabled||busy||!url.trim()} onClick={()=>void load()}>{busy?'Loading image…':'Load image'}</button>{error&&<ErrorBox message={error}/>}</div></details>;
}
function QRPreview({blob,url,alt}: {blob:Blob|null;url:string;alt:string}) {
  const {formatted,checking}=useFormattedQR(blob);
  const [original,setOriginal]=useState(false);
  useEffect(()=>setOriginal(false),[blob]);
  return <><div className="upload-preview"><img src={!original&&formatted?formatted.url:url} alt={alt}/></div>{checking?<p className="footnote" role="status">Preparing a clean QR preview…</p>:formatted?<><p className="footnote">Auto-format ready. The original image will be preserved.</p><button type="button" className="text-button" onClick={()=>setOriginal(v=>!v)}>{original?'Show formatted preview':'Show original preview'}</button></>:<p className="footnote">Original image kept. A clean crop could not be verified.</p>}</>;
}
function QREditor({person,existing,onClose,onSaved,onBusy}:{person:Person;existing:QR|null;onClose:()=>void;onSaved:(pending:boolean)=>Promise<void>;onBusy:(value:boolean)=>void}) {
  const currentImage=useStoredImage(existing?.storage_path??null);
  const [account,setAccount]=useState(existing?.duitnow_account??'');
  const [label,setLabel]=useState(existing?.label??''),[ack,setAck]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),image=useImageSelection(),id=useRef(existing?.id??crypto.randomUUID());
  async function submit(e:FormEvent){e.preventDefault();if(busy||(!existing&&!image.file)||!ack)return;if(!validDuitNowAccount(account.trim())){setError('Use up to 34 digits for the Transferable account number, or leave it blank.');return;}if(!validLabel(label)){setError('Use 1–40 English letters, numbers or basic punctuation. Start with a letter or number.');return;}setBusy(true);onBusy(true);setError('');const form=new FormData();form.set('action','save_qr');form.set('id',id.current);form.set('person_id',person.id);form.set('label',label.trim());form.set('duitnow_account',account.trim());form.set('acknowledged','true');if(image.file)form.set('file',image.file);if(existing)form.set('expected_updated_at',existing.updated_at);try{const result=await manageDirectory(form,setProgress);await onSaved(!!result.cleanupPending);}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}}
  return <Modal title={existing?'Edit payment option':'Add a receiving QR'} onClose={onClose} locked={busy}><p className="muted">For {person.display_name}</p><form className="form" onSubmit={submit}><label>Label<input list="providers" placeholder="e.g. Maybank" value={label} onChange={e=>setLabel(e.target.value)} maxLength={40} required disabled={busy}/><datalist id="providers">{PROVIDERS.map(p=><option key={p} value={p}/>)}</datalist></label><label>Transferable account number (optional)<input type="text" inputMode="numeric" maxLength={34} pattern="[0-9]{1,34}" value={account} onChange={e=>setAccount(e.target.value)} disabled={busy} aria-describedby="duitnow-help" placeholder="e.g. 0123456789"/><small id="duitnow-help" className="muted">For manual transfers only. Leave blank if not needed.</small></label><label className="file-field"><Upload size={22}/><span>{existing?'Replace QR image (optional)':'Choose QR image'}</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>void image.choose(e.target.files?.[0])}/><small>PNG, JPEG or WebP · up to 5 MB</small></label>{existing&&!image.preview&&<><p className="footnote">Your current QR image will be kept unless you choose a replacement.</p>{currentImage.value&&<QRPreview blob={currentImage.value.blob} url={currentImage.value.url} alt="Current receiving QR"/>}</>}<ImageLinkImport disabled={busy} onLoaded={image.choose}/>{image.preview&&<QRPreview blob={image.file} url={image.preview} alt="Original receiving QR preview"/>}<p className="footnote">Use a QR from their Receive money screen, never one used to authorize payments. This does not verify ownership or safety.</p><label className="checkbox"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} required disabled={busy}/><span>This is their receiving QR, and I have permission to share it.</span></label>{(error||image.error)&&<ErrorBox message={error||image.error}/>}<Progress busy={busy} progress={progress}/><div className="form-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy||image.checking||(!existing&&!image.file)||!ack}>{busy?'Saving…':'Save QR'}</button></div></form></Modal>;
}
