import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import type { PromptRow } from '../../../shared/types.ts';

/** Athena's prompt library: tap a prompt to put it in the Ask box (never sent by itself). Add, edit and delete in place; needs a connection. */
export function PromptShelf({ onPick }: { onPick: (body: string) => void }) {
  const [list, setList] = useState<PromptRow[] | null | undefined>(undefined); // undefined: loading, null: no connection
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<{ id: string | null; title: string; body: string } | null>(null);
  const load = () => api<{ prompts: PromptRow[] }>('/prompts').then((r) => setList(r.prompts)).catch(() => setList(null));
  useEffect(() => { void load(); }, []);
  const save = async () => {
    if (!edit || saving) return;
    setSaving(true);
    try {
      await api(edit.id ? `/prompts/${edit.id}` : '/prompts', { method: edit.id ? 'PATCH' : 'POST', json: { title: edit.title, body: edit.body } });
      setEdit(null); toast('Saved'); await load();
    } catch (e) { toast((e as Error).message === 'prompt_limit' ? 'You have 100 prompts; delete one first' : (e as Error).message || 'Could not save'); }
    finally { setSaving(false); }
  };
  const remove = async (p: PromptRow) => {
    if (!(await confirmAction(`Delete the prompt "${p.title}"? It cannot be restored.`, { danger: true }))) return;
    try { await api(`/prompts/${p.id}`, { method: 'DELETE' }); setEdit(null); toast('Prompt deleted'); await load(); }
    catch (e) { toast((e as Error).message || 'Could not delete'); }
  };
  if (list === undefined) return null;
  if (list === null) return <section aria-label="My prompts" className="ath-help"><div className="eyebrow">My prompts</div><small className="sub">Needs a connection.</small></section>;
  return (
    <section aria-label="My prompts" className="ath-help">
      <div className="eyebrow">My prompts</div>
      <div className="row" role="group" aria-label="My prompts">
        {list.map((p) => <button type="button" key={p.id} className="chip ath-more" title="Put in the box" onClick={() => onPick(p.body)}>{p.title}</button>)}
        <button type="button" className="chip ath-more" onClick={() => setEdit({ id: null, title: '', body: '' })}>+ New prompt</button>
        {list.length > 0 && <button type="button" className="chip ath-more" onClick={() => setEdit(edit ? null : { id: list[0].id, title: list[0].title, body: list[0].body })}>{edit ? 'Close' : 'Edit'}</button>}
      </div>
      {edit && <div className="stack">
        {edit.id && <select className="field" aria-label="Prompt to edit" value={edit.id} onChange={(e) => { const p = list.find((x) => x.id === e.target.value)!; setEdit({ id: p.id, title: p.title, body: p.body }); }}>
          {list.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>}
        <input className="field" aria-label="Prompt title" placeholder="Title" maxLength={120} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
        <textarea className="field" aria-label="Prompt text" placeholder="Write my status in Bell's format…" rows={5} maxLength={4000} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
        <div className="row">
          <button type="button" className="btn primary" disabled={saving || !edit.title.trim() || !edit.body.trim()} onClick={() => void save()}>Save</button>
          {edit.id && <button type="button" className="btn danger" onClick={() => void remove(list.find((p) => p.id === edit.id)!)}>Delete</button>}
          <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
        </div>
        <small className="sub">Keep work details out: prompts are saved as plain text.</small>
      </div>}
    </section>
  );
}
