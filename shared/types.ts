export type Kind = 'personal' | 'work';
export type Horizon = 'short' | 'medium' | 'long';
export type Status = 'new' | 'progress' | 'hold' | 'waiting' | 'done';
export type Rag = 'green' | 'amber' | 'red' | 'none';
export type SourceApp = 'manual' | 'finance' | 'health' | 'hollow' | 'aura' | 'home' | 'sonarflow' | 'kelly' | 'email';

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
}
export const DEFAULT_SETTINGS: Settings = {
  day_start_hour: 6, digest_hour: 7, quiet_from: '22:00', quiet_to: '07:00', weekly_review_day: 0,
  wip_limits: { new: null, progress: 5, hold: null, waiting: null, done: null }, saved_views: [], tz: 'America/Toronto',
};
export interface TodayAnswer {
  date: string; short: Task[]; medium: Task[]; long: Task[]; overdue: Task[]; done_this_week: number; open_today: number;
  milestones: (Milestone & { project_name: string })[];
}
