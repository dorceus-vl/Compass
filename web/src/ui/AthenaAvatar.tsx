// Athena's face. For now a still stand-in (the preview's portrait silhouette); Task 3 replaces this file with the video loops, same props.
export type AthenaState = 'idle' | 'listening' | 'thinking' | 'speaking';
const LABEL: Record<AthenaState, string> = { idle: 'Idle', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };

export function AthenaAvatar({ state, size }: { state: AthenaState; size: 'stage' | 'banner' }) {
  return (
    <div className={`ath-frame ${size} ${state}`} role="img" aria-label={`Athena, ${LABEL[state].toLowerCase()}`}>
      <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        <path className="sil" d="M20 400C24 300 100 262 128 250H172C200 262 276 300 280 400Z" />
        <ellipse className="sil" cx="150" cy="152" rx="52" ry="60" />
        {state === 'listening' && [96, 124, 152].map((r) => <circle key={r} className="ring" cx="150" cy="152" r={r} />)}
        {state === 'thinking' && [[212, 138], [150, 100], [96, 150]].map(([x, y], i) => <circle key={i} className={i ? 'orb' : 'orb a'} cx={x} cy={y} r="4.5" />)}
        {state === 'speaking' && [10, 20, 30, 20, 10].map((h, i) => <rect key={i} className="bar" x={118 + i * 16} y={352 - h / 2} width="8" height={h} rx="4" />)}
      </svg>
      <span className="ath-tag"><span className="dot" /><span>{LABEL[state]}</span></span>
    </div>
  );
}
