import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { CardHead } from '../ui/CardHead.tsx';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { templateMeta, type TemplateInfo } from '../ui/Templates.tsx';

/** Settings → Templates: yours (rename in place, delete to Trash for 30 days) and the built-ins (read only). Needs a connection. */
export function TemplatesCard() {
  const [list, setList] = useState<TemplateInfo[] | null | undefined>(undefined); // undefined: loading, null: no connection
  const load = () => api<{ templates: TemplateInfo[] }>('/templates').then((r) => setList(r.templates)).catch(() => setList(null));
  useEffect(() => { void load(); }, []);
  const rename = async (t: TemplateInfo, raw: string, input: HTMLInputElement) => {
    const name = raw.trim();
    if (name === t.name) return;
    if (!name) { input.value = t.name; toast('A template needs a name'); return; }
    try { await api(`/templates/${t.id}`, { method: 'PATCH', json: { name } }); toast('Saved'); await load(); }
    catch (e) { input.value = t.name; toast((e as Error).message || 'Could not rename'); }
  };
  const remove = async (t: TemplateInfo) => {
    if (!(await confirmAction(`Delete the template "${t.name}"? It stays in Trash for 30 days (restore it there); items made from it are not affected.`, { danger: true }))) return;
    try { await api(`/templates/${t.id}`, { method: 'DELETE' }); toast('Template deleted'); await load(); }
    catch (e) { toast((e as Error).message || 'Could not delete'); }
  };
  return (
    <div className="card">
      <CardHead icon="list" title="Templates" desc="Save a task or project from its page, then start new ones from it with New from template." />
      {list === undefined ? null : list === null ? <p className="hint">Needs a connection.</p> : list.map((t) => (
        <div key={t.id} className="tpl-set">
          {t.builtin
            ? <div className="tpl-name"><b>{t.name}</b></div>
            : <input key={`${t.id}:${t.name}`} className="field" aria-label={`Name of template ${t.name}`} defaultValue={t.name} maxLength={200}
                onBlur={(e) => void rename(t, e.target.value, e.target)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}
          <small>{templateMeta(t)}</small>
          {!t.builtin && <button type="button" className="btn" style={{ color: 'var(--danger)' }} aria-label={`Delete template ${t.name}`} onClick={() => void remove(t)}>Delete</button>}
        </div>
      ))}
      {Array.isArray(list) && !list.some((t) => !t.builtin) && <p className="hint" style={{ margin: '10px 0 0' }}>You have not saved any yet.</p>}
    </div>
  );
}
