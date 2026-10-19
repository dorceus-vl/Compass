// The four governance logs (spec §3): what each table accepts, its defaults and its list order. Routes in worker/routes/gov.ts use this one table.
import { checkAll, text, int, oneOf, date, type Check } from './validate.ts';

export type GovTable = 'raid_items' | 'change_requests' | 'decisions' | 'lessons';
export interface GovSpec {
  path: 'raid' | 'changes' | 'decisions' | 'lessons';
  checks: Record<string, Check>;
  required: string[];
  defaults: (today: string) => Record<string, unknown>;
  order: string;
}

export const GOV: Record<GovTable, GovSpec> = {
  raid_items: {
    path: 'raid', required: ['type', 'text'], defaults: () => ({ status: 'open' }), order: 'status, type, created_at',
    checks: {
      type: oneOf('risk', 'assumption', 'issue', 'dependency'), text: text(2000), probability: int(1, 5), impact: int(1, 5), response: text(2000),
      owner: text(200), trigger: text(1000), status: oneOf('open', 'closed'), due_at: date(),
    },
  },
  change_requests: {
    path: 'changes', required: ['title'], defaults: () => ({ decision: 'pending' }), order: 'created_at DESC',
    checks: {
      title: text(200), description: text(5000), impact_scope: text(2000), impact_time: text(2000), impact_cost: text(2000),
      decision: oneOf('pending', 'approved', 'rejected'), approver: text(200), decided_at: date(),
    },
  },
  decisions: {
    path: 'decisions', required: ['text', 'decided_at'], defaults: (today) => ({ decided_at: today }), order: 'decided_at DESC, created_at DESC',
    checks: { text: text(2000), decided_at: date(), at_ref: text(40) },
  },
  lessons: {
    path: 'lessons', required: ['text'], defaults: () => ({}), order: 'created_at DESC',
    checks: { text: text(4000), category: text(60) },
  },
};

/** Checks a create/patch body against the spec. Unchecked fields (project_id, from_meeting_id, enc_v) are dropped. */
export function govInput(spec: GovSpec, body: Record<string, unknown>, create: boolean, today: string, current: Record<string, unknown> = {}): { values: Record<string, unknown> } | { error: string } {
  const r = checkAll(body, spec.checks);
  if ('error' in r) return r;
  const values: Record<string, unknown> = create ? { ...spec.defaults(today), ...r.values } : { ...r.values };
  for (const f of spec.required) {
    if ((create || f in r.values) && (values[f] === null || values[f] === undefined || values[f] === '')) return { error: `${f} is required` };
  }
  if (spec.path === 'changes' && 'decision' in r.values && !('decided_at' in r.values) && r.values.decision !== current.decision) {
    values.decided_at = r.values.decision === 'pending' ? null : today;
  }
  return { values };
}

export { riskScore } from '../../shared/gov.ts';
