import { useEffect, useRef, useState } from 'react';

let pushToast: (t: string) => void = () => {};
export const toast = (t: string) => pushToast(t);
let toastId = 0;
export function Toasts() {
  const [items, set] = useState<{ id: number; t: string }[]>([]);
  pushToast = (t) => { const id = ++toastId; set((xs) => [...xs, { id, t }]); setTimeout(() => set((xs) => xs.filter((x) => x.id !== id)), 2500); };
  return <div className="toasts">{items.map((x) => <div key={x.id} className="toast" role="status">{x.t}</div>)}</div>;
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
          <button className={`btn ${state.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>Confirm</button>
        </div>
      </>}
    </dialog>
  );
}
