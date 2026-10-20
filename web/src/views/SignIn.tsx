import { useRef, useState, type FormEvent } from 'react';
import { api, deviceId, login } from '../api.ts';
import { CursorCompass, FloatingShapes } from '../ui/Hero.tsx';
import { shell, nativeSignIn } from '../native.ts';

// Sign in with Knocturn ID, as Health and Finance do: username + password, then Touch ID / Face ID on the options it
// sends back (the same body again plus the passkey's answer). A device with no passkey yet: "New device?" opens
// Knocturn ID's own page, where a device that has one approves it.
const ID = 'https://id.knocturnlabs.com';

const passkeysSupported = () => typeof window.PublicKeyCredential?.parseRequestOptionsFromJSON === 'function';

function passkeyError(err: any): string {
  if (err?.name === 'NotAllowedError') return 'Cancelled or timed out. Press the button to try again.';
  if (err instanceof DOMException) return "This device couldn't use a passkey.";
  return err?.message || 'Something went wrong. Try again.';
}

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<'password' | 'passkey'>('password');
  const [error, setError] = useState('');
  const [notEnrolled, setNotEnrolled] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  const options = useRef<unknown>(null);
  const sh = shell();
  const [pw, setPw] = useState(false); // Android only: its web view can use a passkey, so the password form stays one tap away

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    pending.current = { username: String(form.get('username') ?? '').trim(), password: String(form.get('password') ?? ''), deviceId: deviceId() };
    setError('');
    setNotEnrolled(false);
    setBusy(true);
    try {
      const r = await login(pending.current);
      if (r.stage === 'passkey') {
        options.current = r.options;
        setStep('passkey');
        if (passkeysSupported()) void usePasskey();
        else setError("This browser can't use passkeys. Update it, or use Safari, Chrome, Edge or Firefox.");
        return;
      }
      onSignedIn();
    } catch (err: any) {
      setError(err.message);
      setNotEnrolled(err.code === 'passkey_not_enrolled');
    } finally {
      setBusy(false);
    }
  }

  async function usePasskey() {
    setError('');
    setBusy(true);
    try {
      const cred = (await navigator.credentials.get({
        publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options.current as PublicKeyCredentialRequestOptionsJSON),
      })) as PublicKeyCredential;
      await login({ ...pending.current, passkey: cred.toJSON() });
      onSignedIn();
    } catch (err: any) {
      // Refused by Knocturn ID: start over from the password so a fresh challenge is issued.
      if (err.code) backToPassword(err.message);
      else setError(passkeyError(err));
    } finally {
      setBusy(false);
    }
  }

  function backToPassword(message = '') {
    pending.current = options.current = null;
    setStep('password');
    setError(message);
  }

  // In an app: Knocturn ID's own page in the system sheet (a passkey can't run in the app's web view on iOS); the page reloads signed in.
  async function appSignIn() {
    setError('');
    setBusy(true);
    try { await nativeSignIn(); } catch (err: any) {
      if (!/cancel/i.test(`${err?.code ?? ''} ${err?.message ?? ''}`)) setError(err?.message || 'Sign-in failed. Try again.'); // closing the sheet is a choice, not an error
      setBusy(false);
    }
  }

  // wrangler dev only (the Worker answers 404 anywhere else): a session without Knocturn ID.
  async function devSignIn() {
    setError('');
    try { await api('/auth/dev-login', { method: 'POST' }); onSignedIn(); } catch (err: any) { setError(err.message); }
  }

  return (
    <main className="signin">
      <div className="sstage">
        {/* Decoration, wide screens only (CSS hides it under 900 px): no focusable content, so it never takes focus or clicks from the form. */}
        <div className="stage" aria-hidden="true"><div className="layer"><FloatingShapes /></div><CursorCompass /></div>
      <div className="card">
        <div className="brand">
          <img src="/icons/icon-192.png" width={34} height={34} alt="" />
          <b>Compass</b>
        </div>

        {sh && !pw ? (
          <section className="stack">
            <div>
              <h1>Where to next</h1>
              <p className="lede">Sign in with your Knocturn ID, the same account as all your Knocturn apps.</p>
            </div>
            <button className="btn primary" type="button" onClick={appSignIn} disabled={busy}>Sign in with Knocturn ID</button>
            <p className="error" role="alert">{error}</p>
            {sh === 'android' && <button className="link" type="button" onClick={() => { setError(''); setPw(true); }}>Use password instead</button>}
          </section>
        ) : step === 'password' ? (
          <form className="stack" onSubmit={submit}>
            <div>
              <h1>Where to next</h1>
              <p className="lede">Sign in with your Knocturn ID, the same account as all your Knocturn apps.</p>
            </div>
            <div>
              <label htmlFor="username">Username</label>
              <input className="field" id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
            </div>
            <div>
              <div className="lr">
                <label htmlFor="password">Password</label>
                <a href={`${ID}/forgot`}>Forgot password?</a>
              </div>
              <input className="field" id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <button className="btn primary" type="submit" disabled={busy}>Log in</button>
            <p className="error" role="alert">
              {error}
              {notEnrolled && <> <a href={`${ID}/admin`}>Open Knocturn ID</a></>}
            </p>
            {location.hostname === 'localhost' && <button className="link" type="button" onClick={devSignIn}>Dev sign-in</button>}
          </form>
        ) : (
          <section className="stack" aria-live="polite">
            <div>
              <h1>Confirm it's you</h1>
              <p className="lede">Use Touch ID, Face ID, or your device's screen lock.</p>
            </div>
            <button className="btn primary" type="button" onClick={usePasskey} disabled={busy || !passkeysSupported()}>Continue with passkey</button>
            <p className="error" role="alert">{error}</p>
            <a className="link" href={`${ID}/`} target="_blank" rel="noopener">New device? Set it up with one that has your passkey</a>
            <button className="link" type="button" onClick={() => backToPassword()}>Use a different account</button>
          </section>
        )}
        <p className="foot">Session kept for 90 days · Knocturn ID</p>
      </div>
      </div>
    </main>
  );
}
