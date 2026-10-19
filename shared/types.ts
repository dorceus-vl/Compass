export type Kind = 'personal' | 'work';
export type Horizon = 'short' | 'medium' | 'long';
export type Status = 'new' | 'progress' | 'hold' | 'waiting' | 'done';
export type Rag = 'green' | 'amber' | 'red' | 'none';
export type SourceApp = 'manual' | 'finance' | 'health' | 'hollow' | 'aura' | 'nightowl' | 'home' | 'sonarflow' | 'kelly' | 'email';

export interface Project {
  id: string; name: string; kind: Kind; status: 'active' | 'on_hold' | 'closed'; rag: Rag; rag_reason: string | null;
  sponsor: string | null; objectives: string | null; scope_in: string | null; scope_out: string | null; success_criteria: string | null;
  phase: string | null; start_at: string | null; end_at: string | null; budget_planned: number | null; budget_spent: number | null;
  data_boundary: 'cloud' | 'offline'; colour: string | null; sort: number; enc_v: number;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export interface Milestone {
  id: string; project_id: string; name: string; due_at: string | null; done_at: string | null; gate: number; sort: number; enc_v: number;
  created_at: string; updated_at: string; deleted_at: string | null;
}
/** recur: {"freq":"daily"|"weekly"|"monthly","interval":1,"weekdays":[1..7]?,"after_completion":false} */
export interface Task {
  id: string; project_id: string | null; parent_id: string | null; title: string; notes: string | null; kind: Kind; horizon: Horizon;
  status: Status; priority: number; start_at: string | null; due_at: string | null; done_at: string | null; estimate_minutes: number | null;
  waiting_on: string | null; waiting_since: string | null; nudge_every_days: number | null; recur: string | null;
  source_app: SourceApp; source_kind: string | null; source_ref: string | null; source_url: string | null;
  sort_in_column: number; tags: string; enc_v: number; created_at: string; updated_at: string; deleted_at: string | null;
}
export interface TaskEvent { id: string; task_id: string; at: string; actor: 'you' | 'rule' | 'kelly' | 'meeting'; type: 'created' | 'moved' | 'edited' | 'comment' | 'nudged' | 'done'; data: string | null; enc_v: number }
export interface Settings {
  day_start_hour: number; digest_hour: number; quiet_from: string; quiet_to: string; weekly_review_day: number;
  wip_limits: Record<Status, number | null>; saved_views: { name: string; query: string }[]; tz: string;
  push: Record<PushType, boolean>; work_email_domains: string[]; last_review_at: string | null;
}
export const DEFAULT_SETTINGS: Settings = {
  day_start_hour: 6, digest_hour: 7, quiet_from: '22:00', quiet_to: '07:00', weekly_review_day: 0,
  wip_limits: { new: null, progress: 5, hold: null, waiting: null, done: null }, saved_views: [], tz: 'America/Toronto',
  push: { digest: true, overdue: true, nudge: true, milestone: true, weekly_review: true, app_task: true, meeting: true },
  work_email_domains: ['bell.ca'], last_review_at: null,
};
export interface TodayAnswer {
  date: string; short: Task[]; medium: Task[]; long: Task[]; overdue: Task[]; done_this_week: number; open_today: number;
  milestones: (Milestone & { project_name: string })[];
}

export type InboxApp = 'finance' | 'health' | 'home' | 'nightowl' | 'kelly' | 'sonarflow' | 'hollow' | 'email';
export type InboxKind = 'notification' | 'meeting' | 'email';
export interface InboxItem {
  id: string; app: InboxApp; kind: InboxKind; work: number; title: string; body: string | null; url: string | null; ref: string | null;
  suggest: string | null; payload: string | null; state: 'new' | 'added' | 'kept' | 'dismissed' | 'snoozed'; rule_id: string | null;
  task_id: string | null; snoozed_until: string | null; received_at: string; updated_at: string; enc_v: number;
}
export type RuleMode = 'task' | 'inbox' | 'ignore';
export interface RuleMatch { suggest?: string; kind?: InboxKind; title_regex?: string }
export interface RuleSet { horizon?: Horizon; kind?: Kind; project_id?: string; due_offset_days?: number; priority?: number; status?: Status }
export interface Rule { id: string; name: string; app: InboxApp | '*'; match: RuleMatch; then_set: RuleSet; mode: RuleMode; dedupe: 'update' | 'skip' | 'always'; enabled: number; sort: number }
export interface MeetingActionItem { text: string; owner: string | null; due: string | null; at: string }
export interface MeetingNotes { title: string; summary: string; decisions: { text: string; at: string }[]; action_items: MeetingActionItem[]; important_notes: { text: string; at: string }[]; open_questions: { text: string; at: string }[] }
export interface MeetingReview {
  id: string; recording_id: string; url: string | null; title: string; summary: string | null; decisions: MeetingNotes['decisions'];
  action_items: MeetingActionItem[]; open_questions: MeetingNotes['open_questions']; important_notes: MeetingNotes['important_notes'];
  project_id: string | null; state: 'new' | 'reviewed'; received_at: string; reviewed_at: string | null;
}
export interface Decision { id: string; project_id: string | null; text: string; decided_at: string; from_meeting_id: string | null; at_ref: string | null }
export type PushType = 'digest' | 'overdue' | 'nudge' | 'milestone' | 'weekly_review' | 'app_task' | 'meeting';
