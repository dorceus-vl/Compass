import { useEffect, useRef, useState } from 'react';
import type { Task, Project, Milestone, RaidItem, ChangeRequest, Decision, Lesson, DocumentRow, AiThread, KnowledgeCollection, KnowledgeItem } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { toast } from '../ui/dialogs.tsx';
import { accent } from '../ui/colors.ts';
import { pull } from '../store/sync.ts';

type InProject<T> = T & { project_name: string | null };
type TrashAnswer = {
  tasks: Task[]; projects: Project[]; milestones: Milestone[]; purge_after_days: number;
  raid_items: InProject<RaidItem>[]; change_requests: InProject<ChangeRequest>[]; decisions: InProject<Decision>[];
  lessons: InProject<Lesson>[]; documents: InProject<DocumentRow>[]; ai_threads: InProject<AiThread>[];
  templates?: { id: string; name: string; deleted_at: string | null }[]; baselines?: InProject<{ id: string; name: string; deleted_at: string | null }>[]; stakeholders?: InProject<{ id: string; name: string; deleted_at: string | null }>[]; knowledge_collections?: KnowledgeCollection[]; knowledge_items?: (KnowledgeItem & { collection_name: string })[];
};
type Table = 'tasks' | 'projects' | 'milestones' | 'raid_items' | 'change_requests' | 'decisions' | 'lessons' | 'documents' | 'ai_threads' | 'knowledge_collections' | 'knowledge_items' | 'templates' | 'baselines' | 'stakeholders';
type TrashRow = { id: string; deleted_at: string | null; title?: string; name?: string; text?: string; project_name?: string | null };

export function TrashView() {
  const [t, setT] = useState<TrashAnswer | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const [word, setWord] = useState('');
  const load = () => api<TrashAnswer>('/trash').then(setT).catch(() => toast('Trash needs a connection'));
  useEffect(() => { void load(); }, []);
  if (!t) return null;
  const restore = async (table: Table, id: string) => {
    try { await api(`/trash/${table}/${id}/restore`, { method: 'POST' }); toast('Restored'); await load(); await pull(); }
    catch (e) { toast((e as Error).message || 'Restore needs a connection'); }
  };
  let g = 0; // each group takes the next swatch
  const section = (title: string, table: Table, rows: TrashRow[]) => {
    if (!rows.length) return null;
    const c = `var(--swatch-${(g++ % 6) + 1})`;
    return (
    <section aria-label={title}>
      <div className="ghead"><b>{title}</b><span className="chip">{rows.length}</span></div>
      <div className="tlist2">{rows.map((r) => <div key={r.id} className="acard trow" style={accent(c)}><div className="tt">{r.title ?? r.name ?? r.text}{r.project_name ? ` · ${r.project_name}` : ''}</div><span className="chip">{r.deleted_at?.slice(0, 10)}</span><button type="button" className="btn" onClick={() => restore(table, r.id)}>Restore</button></div>)}</div>
    </section>);
  };
  const kc = t.knowledge_collections ?? [], ki = (t.knowledge_items ?? []).map((i) => ({ ...i, project_name: i.collection_name }));
  const tp = t.templates ?? [], bl = t.baselines ?? [], sh = t.stakeholders ?? [];
  const total = tp.length + bl.length + sh.length + kc.length + ki.length + t.tasks.length + t.projects.length + t.milestones.length + t.raid_items.length + t.change_requests.length + t.decisions.length + t.lessons.length + t.documents.length + t.ai_threads.length;
  return (
    <>
      <div className="head"><div><div className="eyebrow">Trash</div><h1 style={{ marginTop: 6 }}>Gone, <b>not forgotten</b></h1><div className="sub">{total} item{total === 1 ? '' : 's'} · they stay {t.purge_after_days} days, then go for good.</div></div>
        <button type="button" className="btn" style={{ color: 'var(--danger)' }} disabled={total === 0} onClick={() => dlg.current?.showModal()}>Empty Trash</button></div>
      {total === 0 && <p style={{ color: 'var(--text-faint)' }}>Trash is empty.</p>}
      {section('Tasks', 'tasks', t.tasks)}{section('Projects', 'projects', t.projects)}{section('Milestones', 'milestones', t.milestones)}
      {section('RAID', 'raid_items', t.raid_items)}{section('Changes', 'change_requests', t.change_requests)}{section('Decisions', 'decisions', t.decisions)}
      {section('Lessons', 'lessons', t.lessons)}{section('Documents', 'documents', t.documents)}{section('Athena threads', 'ai_threads', t.ai_threads)}{section('Knowledge collections', 'knowledge_collections', kc)}{section('Knowledge items', 'knowledge_items', ki)}{section('Templates', 'templates', tp)}{section('Baselines', 'baselines', bl)}{section('Stakeholders', 'stakeholders', sh)}
      <dialog ref={dlg} onClose={() => setWord('')}><p>This deletes everything in Trash for good. Type <b>EMPTY</b> to continue; your passkey is asked next.</p>
        <input className="field" aria-label="Type EMPTY to confirm" value={word} onChange={(e) => setWord(e.target.value)} />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
          <button type="button" className="btn danger" disabled={word !== 'EMPTY'} onClick={async () => { try { await api('/trash/empty', { method: 'POST' }); toast('Trash emptied'); dlg.current?.close(); await load(); } catch (e) { toast((e as Error).message); } }}>Empty Trash</button></div></dialog>
    </>
  );
}
