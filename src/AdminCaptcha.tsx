import { useEffect, useRef, useState } from 'react';

type Turnstile = {
  render: (container: HTMLElement, options: {
    sitekey: string; theme: 'dark'; size: 'flexible';
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }) => string;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      window.clearTimeout(timeout);
      script.remove();
      loading = undefined;
      reject(new Error('Verification could not load.'));
    };
    const timeout = window.setTimeout(fail, 20_000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else fail();
    };
    document.head.append(script);
  });
  return loading;
}

// Mounted only on the admin login form. Supabase verifies the resulting token;
// disabling a browser button alone is never a security boundary.
export function AdminCaptcha({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let widget: string | undefined;
    let api: Turnstile | undefined;
    callback.current('');
    setFailed(false);
    void loadTurnstile().then(turnstile => {
      if (cancelled || !container.current) return;
      api = turnstile;
      widget = turnstile.render(container.current, {
        sitekey: siteKey, theme: 'dark', size: 'flexible',
        callback: token => { if (!cancelled) { setFailed(false); callback.current(token); } },
        'expired-callback': () => { if (!cancelled) callback.current(''); },
        'error-callback': () => { if (!cancelled) { callback.current(''); setFailed(true); } },
      });
    }).catch(() => { if (!cancelled) { callback.current(''); setFailed(true); } });
    return () => { cancelled = true; if (widget !== undefined) api?.remove(widget); };
  }, [siteKey, attempt]);
  return <div className="admin-captcha">
    <div ref={container} aria-label="Security verification" />
    {failed && <div role="alert"><p>Verification couldn’t load. Check your connection and try again.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry verification</button></div>}
  </div>;
}
