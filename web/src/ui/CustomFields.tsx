import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Project, Task } from '../../../shared/types.ts';
import { parseFieldDefs, parseFieldValues, fieldValue, setFieldValue, FIELD_TYPES, MAX_FIELDS, MAX_OPTIONS, type FieldDef, type FieldType } from '../../../shared/fields.ts';
import { updateProject, updateTask } from '../store/useStore.ts';
import { confirmAction, toast } from './dialogs.tsx';

const TYPE_LABEL: Record<FieldType, string> = { number: 'Number', text: 'Text', choice: 'Choice', date: 'Date', person: 'Person' };
/** "a, b, a" → ['a', 'b']; null when an option is over 60 characters or there are more than 30. */
const parseOptions = (s: string) => { const o = [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))]; return o.length > MAX_OPTIONS || o.some((x) => x.length > 60) ? null : o; };

/** The last value this component queued, until the store catches up: two quick edits must build on each other, not on a stale prop. */
export function useLatest(prop: string | null | undefined) {
  const sent = useRef<string | null | undefined>(undefined);
  useEffect(() => { if ((prop ?? null) === sent.current) sent.current = undefined; }, [prop]); // an older write landing must not drop a newer one
  return { get: () => sent.current !== undefined ? sent.current : prop ?? null, set: (v: string | null) => { sent.current = v; } };
}

/** Project overview card (v2.7): add, rename, edit choices, remove. A field's type is fixed once added, so stored values never change meaning. */
export function FieldsEditor({ project }: { project: Project }) {
  const latest = useLatest(project.fields);
  const defs = parseFieldDefs(project.fields) ?? [];
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const [options, setOptions] = useState('');
  const put = (change: (d: FieldDef[]) => FieldDef[]) => {
    const next = change(parseFieldDefs(latest.get()) ?? []);
    if (next.length > MAX_FIELDS) { toast('Twenty fields at most'); return; }
    const v = next.length ? JSON.stringify(next) : null;
    latest.set(v);
    void updateProject(project.id, { fields: v });
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (n.length > 60) { toast('Keep the name to 60 characters'); return; }
    const o = type === 'choice' ? parseOptions(options) : [];
    if (!o || (type === 'choice' && !o.length)) { toast('A choice needs 1 to 30 options, comma separated, each up to 60 characters'); return; }
    put((d) => [...d, { id: crypto.randomUUID().slice(0, 8), name: n, type, ...(type === 'choice' ? { options: o } : {}) }]);
    setName(''); setOptions('');
  };
  return <>
    {defs.map((d) => (
      <div key={d.id} className="qf">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input key={d.name} className="field" aria-label={`${d.name}: name`} defaultValue={d.name} maxLength={60} onBlur={(e) => {
            const n = e.target.value.trim();
            if (!n) { e.target.value = d.name; return; }
            if (n !== d.name) put((all) => all.map((x) => x.id === d.id ? { ...x, name: n } : x));
          }} />
          <span className="chip" title="The type is fixed once the field is added">{TYPE_LABEL[d.type]}</span>
          <button type="button" className="btn" aria-label={`Remove the field ${d.name}`} onClick={async () => {
            if (await confirmAction(`Remove the field "${d.name}"? Its values stop showing on this project's tasks.`)) put((all) => all.filter((x) => x.id !== d.id));
          }}>Remove</button>
        </div>
        {d.type === 'choice' && <input key={d.options?.join()} className="field" aria-label={`${d.name}: options, comma separated`} defaultValue={d.options?.join(', ')} onBlur={(e) => {
          const o = parseOptions(e.target.value);
          if (!o || !o.length) { toast('A choice needs 1 to 30 options, each up to 60 characters'); e.target.value = d.options?.join(', ') ?? ''; return; }
          if (o.join() !== d.options?.join()) put((all) => all.map((x) => x.id === d.id ? { ...x, options: o } : x));
        }} />}
      </div>
    ))}
    {defs.length < MAX_FIELDS ? <form onSubmit={add} style={{ display: 'grid', gap: 6 }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input className="field" placeholder="New field" aria-label="New field name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <select className="field" aria-label="New field type" value={type} onChange={(e) => setType(e.target.value as FieldType)} style={{ width: 'auto' }}>
          {FIELD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
      </div>
      {type === 'choice' && <input className="field" placeholder="Options, comma separated" aria-label="New field options" value={options} onChange={(e) => setOptions(e.target.value)} />}
      <button className="btn primary" style={{ justifySelf: 'start' }}>Add field</button>
    </form> : <div className="qnote">Twenty fields at most.</div>}
    <div className="qnote">Every task in this project shows these fields.</div>
  </>;
}

/** The project's fields on a task sheet. Each value is checked against its type here; the server checks only the shape. */
export function TaskFields({ task, project }: { task: Task; project: Project | undefined }) {
  const latest = useLatest(task.field_values);
  const defs = parseFieldDefs(project?.fields) ?? [];
  if (!defs.length) return null;
  const values = parseFieldValues(task.field_values) ?? {};
  const set = (d: FieldDef, raw: string, el: HTMLInputElement | HTMLSelectElement) => {
    const val = el instanceof HTMLInputElement && el.validity.badInput ? null : fieldValue(d, raw); // "1e" reads as '' in a number input: refuse, never clear
    if (val === null) { toast(d.type === 'number' ? `${d.name} takes a number` : `${d.name}: up to 500 characters`); el.value = String(values[d.id] ?? ''); return; }
    const next = setFieldValue(defs, latest.get(), d.id, val);
    if (next === (latest.get() || null)) return; // unchanged: no PATCH for a field tabbed through
    latest.set(next);
    void updateTask(task.id, { field_values: next });
  };
  const label = { display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-faint)' } as const;
  return (
    <section aria-label="Custom fields" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
      {defs.map((d) => { const cur = values[d.id] === undefined ? '' : String(values[d.id]); return (
        <label key={d.id} style={label}>{d.name}
          {d.type === 'choice' ? <select className="field" value={cur} onChange={(e) => set(d, e.target.value, e.target)}>
              <option value="">None</option>{[...new Set([...(d.options ?? []), ...(cur ? [cur] : [])])].map((o) => <option key={o} value={o}>{o}</option>)}</select>
            : d.type === 'date' ? <input className="field" type="date" value={cur} onChange={(e) => set(d, e.target.value, e.target)} />
            : <input key={cur} className="field" type={d.type === 'number' ? 'number' : 'text'} step="any" maxLength={500} defaultValue={cur} placeholder={d.type === 'person' ? 'Name' : undefined} onBlur={(e) => set(d, e.target.value, e.target)} />}
        </label>); })}
    </section>
  );
}
