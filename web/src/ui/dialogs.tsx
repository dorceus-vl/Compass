import { useEffect, useRef, useState } from 'react';

let pushToast: (t: string) => void = () => {};
export const toast = (t: string) => pushToast(t);
export function Toasts() {
  const [items, set] = useState<string[]>([]);
  pushToast = (t) => { set((xs) => [...xs, t]); setTimeout(() => set((xs) => xs.slice(1)), 2500); };
  return <>{items.map((t, i) => <div key={i} className="toast" role="status">{t}</div>)}</>;
}

let ask: (text: string, danger: boolean) => Promise<boolean> = async () => false;
export const confirmAction = (text: string, opts: { danger?: boolean } = {}) => ask(text, !!opts.danger);
export function ConfirmDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, set] = useState<{ text: string; danger: boolean; resolve: (b: boolean) => void } | null>(null);
  ask = (text, danger) => new Promise((resolve) => set({ text, danger, resolve }));
  useEffect(() => { if (state) ref.current?.showModal(); }, [state]);
  const close = (b: boolean) => { state?.resolve(b); set(null); ref.current?.close(); };
  return (
    <dialog ref={ref} onClose={() => close(false)}>
      {state && <>
        <p style={{ marginTop: 0 }}>{state.text}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => close(false)}>Cancel</button>
          <button className="btn primary" style={state.danger ? { background: 'var(--danger)', color: '#fff' } : undefined} onClick={() => close(true)}>Confirm</button>
        </div>
      </>}
    </dialog>
  );
}
