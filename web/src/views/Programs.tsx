import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Program, Project, Task } from '../../../shared/types.ts';
import { budgetRows, budgetTotals } from '../../../shared/program.ts';
import { online, SignedOut } from '../api.ts';
import { useStore } from '../store/useStore.ts';
import { Link, navigate } from '../router.ts';
import { RagPill } from '../ui/ProjectCard.tsx';
import { toast } from '../ui/dialogs.tsx';
import { loadPrograms, createProgram, OFFLINE_LINE } from '../programs.ts';

/** The live members of a program (a trashed project never counts). */
export const membersOf = (programId: string, projects: Project[]) => projects.filter((p) => p.program_id === programId && !p.deleted_at);
/** % done over the live top-level tasks of all members together. */
export function pctDone(members: Project[], tasks: Task[]) {
  const ids = new Set(members.map((p) => p.id));
  const top = tasks.filter((t) => t.project_id && ids.has(t.project_id) && !t.deleted_at && !t.parent_id);
  return top.length ? Math.round((100 * top.filter((t) => t.status === 'done').length) / top.length) : 0;
}

/** Hook: the live programs, network first with the cached copy offline. */
export function usePrograms() {
  const [s, set] = useState<{ programs: Program[] | null; offline: boolean }>({ programs: null, offline: false });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    loadPrograms().then(({ data, offline }) => { if (live) set({ programs: data ?? [], offline }); }).catch(() => {}); // only SignedOut reaches here
    return () => { live = false; };
  }, [n]);
  return { ...s, reload: () => setN((x) => x + 1) };
}

/** `/programs`: one card per program (its RAG, members, % done, budget used per currency) and "New program". */
export function Programs() {
  const { projects, tasks } = useStore();
  const { programs, offline } = usePrograms();
  const dlg = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = !offline && online();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const p = await createProgram({ name: String(f.get('name')).trim(), kind: f.get('kind') === 'work' ? 'work' : 'personal' });
      dlg.current?.close(); navigate(`/programs/${p.id}`);
    } catch (err) { if (!(err instanceof SignedOut)) toast((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div className="row">
        <button type="button" className="btn primary" disabled={!canWrite} onClick={() => dlg.current?.showModal()}>+ New program</button>
        {offline && <span className="sub" role="status">Offline: showing the last copy.</span>}
        {!canWrite && <span className="sub">{OFFLINE_LINE}</span>}
      </div>
      <div className="pgrid">
        {(programs ?? []).map((g) => {
          const members = membersOf(g.id, projects), pct = pctDone(members, tasks);
          const totals = budgetTotals(budgetRows(members));
          return (
            <article key={g.id} className="pcard">
              <Link to={`/programs/${g.id}`} className="lift">
                <div className="prow"><RagPill rag={g.rag} /><span className="chip">{g.kind}</span></div>
                <div className="ptx"><h3>{g.name}</h3>
                  <p>{members.length} project{members.length === 1 ? '' : 's'} · {pct}% done</p></div>
                <div className="prow"><span>{totals.length ? totals.map((t) => (t.pct_spent == null ? `${t.currency}: no plan` : `${t.currency} ${t.pct_spent}% spent`)).join(' · ') : 'No planned budget'}</span></div>
              </Link>
            </article>
          );
        })}
        {programs && !programs.length && <p className="hint">No programs yet. A program groups projects of the same kind.</p>}
      </div>
      <dialog ref={dlg}><form onSubmit={submit} style={{ display: 'grid', gap: 10 }}><b>New program</b>
        <input className="field" name="name" placeholder="Name" required maxLength={120} autoFocus />
        <select className="field" name="kind"><option value="personal">Personal</option><option value="work">Work (encrypted)</option></select>
        <p className="hint">Only projects of the same kind can join it.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn primary" disabled={busy || !canWrite}>Create</button></div></form></dialog>
    </>
  );
}
