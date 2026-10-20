import { useEffect, useMemo, useRef, useState } from 'react';
import { mediaUrl, useAthenaMedia, useReducedMotion } from '../athena-media.ts';

// Athena's face: her clips for the state (two stacked muted videos that crossfade, as in Kelly's player), or her still portrait, or the stand-in silhouette.
export type AthenaState = 'idle' | 'listening' | 'thinking' | 'speaking';
const LABEL: Record<AthenaState, string> = { idle: 'Idle', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };
const FADE_MS = 400, RATE = 0.75;
type Layer = 0 | 1;

function StandIn({ state }: { state: AthenaState }) {
  return (
    <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <path className="sil" d="M20 400C24 300 100 262 128 250H172C200 262 276 300 280 400Z" />
      <ellipse className="sil" cx="150" cy="152" rx="52" ry="60" />
      {state === 'listening' && [96, 124, 152].map((r) => <circle key={r} className="ring" cx="150" cy="152" r={r} />)}
      {state === 'thinking' && [[212, 138], [150, 100], [96, 150]].map(([x, y], i) => <circle key={i} className={i ? 'orb' : 'orb a'} cx={x} cy={y} r="4.5" />)}
      {state === 'speaking' && [10, 20, 30, 20, 10].map((h, i) => <rect key={i} className="bar" x={118 + i * 16} y={352 - h / 2} width="8" height={h} rx="4" />)}
    </svg>
  );
}

export function AthenaAvatar({ state, size }: { state: AthenaState; size: 'stage' | 'banner' }) {
  const media = useAthenaMedia(), reduced = useReducedMotion();
  const [bad, setBad] = useState<ReadonlySet<string>>(() => new Set()); // clips that would not load: skipped from then on
  const [view, setView] = useState<{ a: Layer; s: [string | null, string | null] }>({ a: 0, s: [null, null] }); // which layer shows, and the clip id in each
  const vref = useRef(view); vref.current = view;
  const vid = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const pending = useRef<Layer | null>(null); // the standby layer a crossfade is waiting on
  const turn = useRef<Record<string, number>>({}); // per state: which of its clips plays next

  // This state's clips, or idle's when it has none.
  const ids = useMemo(() => {
    const live = (media?.clips ?? []).filter((c) => !bad.has(c.id));
    const own = live.filter((c) => c.state === state);
    return (own.length ? own : live.filter((c) => c.state === 'idle')).map((c) => c.id);
  }, [media, state, bad]);
  const still = reduced || ids.length === 0;
  const cfg = useRef({ state, ids }); cfg.current = { state, ids };

  /** Bring `id` in on the standby layer; it fades in once it is really playing (onPlaying). */
  const show = (id: string) => {
    const { a, s } = vref.current, b: Layer = a ? 0 : 1;
    if (s[a] === id) { pending.current = null; vid[b].current?.pause(); void vid[a].current?.play().catch(() => {}); return; } // the clip on show is the one wanted: drop any fade still waiting
    pending.current = b;
    if (s[b] === id) { const v = vid[b].current; if (v) { v.pause(); v.currentTime = 0; v.playbackRate = RATE; void v.play().catch(() => {}); } return; } // pause first: a layer still playing from the last fade would send no new `playing`
    setView({ a, s: b ? [s[0], id] : [id, s[1]] }); // the new src loads, onLoadedMetadata starts it
  };
  const next = () => { const { state: st, ids: l } = cfg.current; return l[(turn.current[st] ?? 0) % l.length]; };

  const key = ids.join(',');
  useEffect(() => {
    if (still) { pending.current = null; setView({ a: 0, s: [null, null] }); return; }
    const id = next();
    if (id) show(id);
  }, [still, key, state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing plays while the tab is hidden.
  useEffect(() => {
    const f = () => { const { a } = vref.current; if (document.hidden) vid.forEach((v) => v.current?.pause()); else void vid[a].current?.play().catch(() => {}); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const layer = (n: Layer) => {
    const id = view.s[n];
    return (
      <video key={n} ref={vid[n]} className={view.a === n ? 'on' : undefined} src={id ? mediaUrl(id) : undefined} muted playsInline preload="metadata" aria-hidden="true"
        loop={ids.length === 1 && id === ids[0]}
        onLoadedMetadata={(e) => { e.currentTarget.playbackRate = RATE; if (pending.current === n) void e.currentTarget.play().catch(() => {}); }}
        onPlaying={(e) => {
          e.currentTarget.playbackRate = RATE;
          if (pending.current !== n) return;
          pending.current = null;
          const old: Layer = n ? 0 : 1;
          setView((v) => ({ ...v, a: n }));
          setTimeout(() => { if (vref.current.a === n && pending.current !== old) vid[old].current?.pause(); }, FADE_MS + 50);
        }}
        onEnded={() => { if (vref.current.a !== n) return; const st = cfg.current.state; turn.current[st] = (turn.current[st] ?? 0) + 1; const id2 = next(); if (id2) show(id2); }}
        onError={() => { if (id) setBad((b) => new Set(b).add(id)); }} />
    );
  };

  const portrait = media?.portrait_id;
  return (
    <div className={`ath-frame ${size} ${state}`} role="img" aria-label={`Athena, ${LABEL[state].toLowerCase()}`}>
      {portrait ? <img className="ath-still" src={mediaUrl(portrait)} alt="" draggable={false} /> : <StandIn state={state} />}
      {!still && layer(0)}{!still && layer(1)}
      <span className="ath-tag"><span className="dot" /><span>{LABEL[state]}</span></span>
    </div>
  );
}
