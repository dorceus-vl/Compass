import type { AgentScope } from './types.ts';

// Words for Kelly's calls, the documents given to her and changes to her access: used by Settings and the activity log, and by scripts/kelly.test.ts. Plain text only.
export const SCOPE_LABEL: Record<AgentScope, string> = {
  'compass:read.tasks': 'See your shared tasks', 'compass:write.tasks': 'Add and complete tasks', 'compass:read.projects': 'See your shared projects',
};

const ACTION: Record<string, string> = {
  'agent.today': "Listed today's tasks", 'agent.tasks.list': 'Listed tasks', 'agent.tasks.create': 'Added a task', 'agent.tasks.done': 'Completed a task', 'agent.projects': 'Listed shared projects',
};
const REFUSED: Record<string, string> = {
  kelly_disabled: 'Kelly is switched off', scope_not_granted: 'no permission', not_found: 'not found', rate_limited: 'too many calls', write_limit: 'too many changes', invalid: 'bad request', error: 'something went wrong',
};
type Access = { enabled?: unknown; scopes?: unknown } | null | undefined;
const scopes = (a: Access) => (Array.isArray(a?.scopes) ? (a!.scopes as string[]).filter((s): s is AgentScope => s in SCOPE_LABEL) : []);

/** The log line for an audit row: `title` is what happened, `sub` the call it was about (refusals) or what is allowed now (access changes). */
export function kellyLine(action: string, detail: unknown): { title: string; sub: string | null } {
  const d = (detail && typeof detail === 'object' ? detail : {}) as { refused?: unknown; before?: Access; after?: Access };
  if (action === 'kelly.scopes') {
    const was = d.before?.enabled === true, now = d.after?.enabled === true;
    const allowed = scopes(d.after).map((s) => SCOPE_LABEL[s]);
    if (was !== now) return { title: `You turned Kelly ${now ? 'on' : 'off'}`, sub: null };
    return { title: "You changed what Kelly may do", sub: allowed.length ? `Allowed: ${allowed.join(', ')}` : 'Nothing allowed' };
  }
  if (action === 'kelly.document') {
    const ok = (detail as { ok?: unknown } | null)?.ok === true;
    return ok ? { title: 'Gave Kelly a document', sub: 'She keeps her copy; remove it in Kelly' } : { title: "Kelly couldn't take a document", sub: null };
  }
  const what = ACTION[action] ?? 'Made a call';
  if (typeof d.refused === 'string') return { title: `Refused: ${REFUSED[d.refused] ?? 'not allowed'}`, sub: what };
  return { title: what, sub: null };
}
