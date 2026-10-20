import { useEffect, useState, type ChangeEvent } from 'react';
import type { AthenaClipState, Settings } from '../../../shared/types.ts';
import { api, online, SignedOut } from '../api.ts';
import { mediaUrl, reloadAthenaMedia, useAthenaMedia, useReducedMotion } from '../athena-media.ts';
import { toast } from '../ui/dialogs.tsx';
import { CardHead } from '../ui/CardHead.tsx';
import { AthenaAvatar } from '../ui/AthenaAvatar.tsx';

const STATES: { id: AthenaClipState; label: string; hint: string }[] = [
  { id: 'idle', label: 'Idle', hint: 'Waiting for you. Also plays for any state with no clips of its own.' },
  { id: 'listening', label: 'Listening', hint: 'While you speak to her.' },
  { id: 'thinking', label: 'Thinking', hint: 'From the moment you send until her answer arrives.' },
  { id: 'speaking', label: 'Speaking', hint: 'Just after an answer lands, or while her voice plays.' },
];
const MB = 1024 * 1024;
type Patch = (p: Partial<Settings>) => Promise<void>;

/** Settings → Athena: her loops (private, uploaded here), her portrait, a live preview, and her voice. */
export function AthenaCard({ s, save }: { s: Settings; save: Patch }) {
  const media = useAthenaMedia(), reduced = useReducedMotion();
  const [pv, setPv] = useState<AthenaClipState | 'auto'>('auto');
  const [auto, setAuto] = useState(0);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (pv !== 'auto' || reduced) return;
    const t = setInterval(() => setAuto((n) => (n + 1) % STATES.length), 5000);
    return () => clearInterval(t);
  }, [pv, reduced]);
  const shown = pv === 'auto' ? STATES[auto]!.id : pv;
  const clips = media?.clips ?? [];

  const send = async (key: string, path: string, f: File, type: string, headers: Record<string, string> = {}) => {
    if (!online()) { toast('Uploading needs a connection'); return; }
    setBusy(key);
    try { await api(path, { method: 'POST', headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(f.name), ...headers }, body: f }); await reloadAthenaMedia(); toast('Saved'); }
    catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); }
    finally { setBusy(''); }
  };
  const pickClip = (state: AthenaClipState) => (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (f.type !== 'video/mp4' && !/\.mp4$/i.test(f.name)) { toast('Clips are MP4 videos'); return; }
    if (f.size > 15 * MB) { toast('Clips must be 15 MB or smaller'); return; }
    void send(`up:${state}`, `/athena/clips?state=${state}`, f, 'video/mp4');
  };
  const pickPortrait = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const type = f.type || (/\.png$/i.test(f.name) ? 'image/png' : /\.jpe?g$/i.test(f.name) ? 'image/jpeg' : '');
    if (type !== 'image/png' && type !== 'image/jpeg') { toast('The portrait is a PNG or JPG'); return; }
    if (f.size > 2 * MB) { toast('The portrait must be 2 MB or smaller'); return; }
    void send('portrait', '/athena/portrait', f, type);
  };
  const remove = async (key: string, path: string) => {
    setBusy(key);
    try { await api(path, { method: 'DELETE' }); await reloadAthenaMedia(); toast('Removed. It stays in Trash for 30 days.'); }
    catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); }
    finally { setBusy(''); }
  };

  return (
    <div className="card ath-set">
      <CardHead icon="athena" title="Athena" desc="Her loops and portrait are your own files, kept private. Without a clip she shows her portrait; without either, a silhouette." />
      <div className="ath-set-top">
        <div className="ath-set-prev">
          <AthenaAvatar state={shown} size="stage" />
          <div className="ath-types" role="group" aria-label="Preview state">
            {(['auto', ...STATES.map((x) => x.id)] as const).map((id) => (
              <button key={id} type="button" className={`chip ath-more${pv === id ? ' on' : ''}`} aria-pressed={pv === id} onClick={() => setPv(id)}>{id === 'auto' ? 'Auto' : STATES.find((x) => x.id === id)!.label}</button>))}
          </div>
        </div>
        <div className="ath-set-portrait">
          {media?.portrait_id ? <img src={mediaUrl(media.portrait_id)} alt="Athena's portrait" width={64} height={64} /> : <span className="ath-set-none" aria-hidden="true" />}
          <div>
            <b>Portrait</b>
            <p className="hint">Her still face and her icon in the menu. PNG or JPG, up to 2 MB.</p>
            <div className="ath-btns">
              <label className="btn" aria-disabled={busy === 'portrait'}>{media?.portrait_id ? 'Replace' : 'Upload'}<input type="file" className="sr-only" accept="image/png,image/jpeg" disabled={!!busy} onChange={pickPortrait} /></label>
              {media?.portrait_id && <button type="button" className="btn" disabled={!!busy} onClick={() => void remove('portrait', '/athena/portrait')}>Remove</button>}
            </div>
          </div>
        </div>
      </div>
      {STATES.map(({ id, label, hint }) => {
        const mine = clips.filter((c) => c.state === id);
        return (
          <div key={id} className="ath-set-state">
            <div className="ath-set-head"><div><b>{label}</b><p className="hint">{hint}</p></div>
              <label className="btn" aria-disabled={busy === `up:${id}`}>{busy === `up:${id}` ? 'Uploading…' : 'Add clip'}<input type="file" className="sr-only" accept="video/mp4,.mp4" disabled={!!busy} onChange={pickClip(id)} /></label></div>
            {mine.length === 0 ? <p className="hint">No clips yet.</p> : mine.map((c) => (
              <div key={c.id} className="kelly-row"><span className="ath-set-name">{c.name}</span><span>{c.bytes < MB ? `${Math.max(1, Math.round(c.bytes / 1024))} KB` : `${(c.bytes / MB).toFixed(1)} MB`}</span>
                <button type="button" className="btn" disabled={!!busy} onClick={() => void remove(`rm:${c.id}`, `/athena/clips/${c.id}`)} aria-label={`Remove ${c.name}`}>Remove</button></div>))}
          </div>);
      })}
      <p className="kelly-note">Short silent MP4 loops, H.264, 720p or less, 3 to 10 seconds, up to 15 MB each and 40 in all. With several clips for a state she plays them in turn.</p>
      <div className="ath-set-voice">
        <b>Voice</b>
        <label className="kelly-row"><span>ElevenLabs voice id</span>
          <input key={s.athena.voice_id ?? ''} className="field" defaultValue={s.athena.voice_id ?? ''} placeholder="not chosen" maxLength={64} autoComplete="off" spellCheck={false}
            onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== s.athena.voice_id) void save({ athena: { ...s.athena, voice_id: v } }); }} /></label>
        <label className="kelly-row"><span>Speak her answers</span><span className="tog"><input type="checkbox" role="switch" checked={s.athena.speak_answers} disabled={!s.athena.voice_id}
          onChange={(e) => void save({ athena: { ...s.athena, speak_answers: e.target.checked } })} /><i /></span></label>
      </div>
    </div>
  );
}
