import type { ExportBundle, Task } from '../../../shared/types.ts';

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
const one = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const live = <T extends { deleted_at: string | null }>(xs: T[]) => xs.filter((x) => !x.deleted_at);
const section = (title: string, lines: string[]) => (lines.length ? [`## ${title}`, '', ...lines, ''] : []);
const meta = (...xs: [string, unknown][]) => xs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (k ? `${k} ${v}` : String(v))).join(' · ');

function taskLines(all: Omit<Task, 'enc_v'>[], under: (t: Omit<Task, 'enc_v'>) => boolean): string[] {
  const line = (t: Omit<Task, 'enc_v'>, depth: number): string[] => {
    const info = meta(['', t.status === 'done' ? '' : t.status], ['due', t.due_at], ['waiting on', one(t.waiting_on)], ['done', t.done_at?.slice(0, 10)]);
    const pad = '  '.repeat(depth);
    return [
      `${pad}- [${t.status === 'done' ? 'x' : ' '}] ${one(t.title)}${info ? ` (${info})` : ''}`,
      ...(t.notes ? t.notes.trim().split('\n').map((n) => `${pad}  > ${n}`) : []),
      ...all.filter((c) => c.parent_id === t.id).flatMap((c) => line(c, depth + 1)),
    ];
  };
  return all.filter((t) => !t.parent_id && under(t)).flatMap((t) => line(t, 0));
}
function tasks(all: Omit<Task, 'enc_v'>[]): string[] {
  const open = taskLines(all, (t) => t.status !== 'done'), done = taskLines(all, (t) => t.status === 'done');
  return [...(open.length ? ['### Open', '', ...open, ''] : []), ...(done.length ? ['### Done', '', ...done, ''] : [])];
}

/** File name → Markdown: one file per live project, plus the tasks that have no project. Trashed rows are left out (the JSON export keeps them). */
export function exportMarkdown(b: ExportBundle): Record<string, string> {
  const files: Record<string, string> = {};
  const allTasks = live(b.tasks);
  for (const p of live(b.projects)) {
    const mine = <T extends { project_id: string | null; deleted_at: string | null }>(xs: T[]) => live(xs).filter((x) => x.project_id === p.id);
    const text = (title: string, v: string | null) => (v ? [`**${title}:** ${v.trim()}`, ''] : []);
    files[`projects/${slug(p.name)}-${p.id.slice(0, 6)}.md`] = [
      `# ${one(p.name)}`, '',
      meta(['Kind:', p.kind], ['Status:', p.status.replace('_', ' ')], ['Phase:', one(p.phase)], ['RAG:', p.rag === 'none' ? '' : `${p.rag}${p.rag_reason ? ` (${one(p.rag_reason)})` : ''}`]) , '',
      meta(['Sponsor:', one(p.sponsor)], ['Start:', p.start_at], ['End:', p.end_at], ['Budget planned:', p.budget_planned], ['spent:', p.budget_spent], ['Data boundary:', p.data_boundary]), '',
      ...text('Objectives', p.objectives), ...text('In scope', p.scope_in), ...text('Out of scope', p.scope_out), ...text('Success criteria', p.success_criteria),
      ...section('Milestones', mine(b.milestones).sort((a, c) => (a.due_at ?? '9').localeCompare(c.due_at ?? '9'))
        .map((m) => `- [${m.done_at ? 'x' : ' '}] ${m.gate ? '◆ ' : ''}${one(m.name)}${m.due_at ? ` (due ${m.due_at})` : ''}`)),
      ...(() => { const t = tasks(mine(allTasks)); return t.length ? ['## Tasks', '', ...t] : []; })(),
      ...section('RAID', mine(b.raid_items).map((r) => {
        const info = meta(['P', r.probability], ['I', r.impact], ['owner', one(r.owner)], ['response', one(r.response)]);
        return `- **${r.type}**${r.status === 'closed' ? ' (closed)' : ''}: ${one(r.text)}${info ? ` (${info})` : ''}`;
      })),
      ...section('Changes', mine(b.change_requests).map((c) => `- ${one(c.title)} (${c.decision}${c.approver ? `, ${one(c.approver)}` : ''})${c.description ? `: ${one(c.description)}` : ''}`)),
      ...section('Decisions', mine(b.decisions).map((d) => `- ${d.decided_at.slice(0, 10)}: ${one(d.text)}`)),
      ...section('Lessons', mine(b.lessons).map((l) => `- ${one(l.text)}`)),
    ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trimEnd() + '\n';
  }
  const loose = tasks(allTasks.filter((t) => !t.project_id));
  files['tasks-without-project.md'] = ['# Tasks without a project', '', ...(loose.length ? loose : ['None.', ''])].join('\n').trimEnd() + '\n';
  return files;
}
