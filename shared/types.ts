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
export type PortfolioRow = Project & {
  open_tasks: number; done_tasks: number; pct_done: number; next_milestone: { name: string; due_at: string } | null;
  open_risks: number; high_risks: number; pending_changes: number;
};
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
  ai_monthly_cap_micro: number; default_provider: Provider;
  /** What Kelly's agent API may do (changed only through PUT /api/kelly, never PATCH /api/settings). Off by default. */
  kelly: { enabled: boolean; scopes: AgentScope[] };
}
export type AgentScope = 'compass:read.tasks' | 'compass:write.tasks' | 'compass:read.projects';
export const DEFAULT_SETTINGS: Settings = {
  day_start_hour: 6, digest_hour: 7, quiet_from: '22:00', quiet_to: '07:00', weekly_review_day: 0,
  wip_limits: { new: null, progress: 5, hold: null, waiting: null, done: null }, saved_views: [], tz: 'America/Toronto',
  push: { digest: true, overdue: true, nudge: true, milestone: true, weekly_review: true, app_task: true, meeting: true },
  work_email_domains: ['bell.ca'], last_review_at: null, ai_monthly_cap_micro: 20000000, default_provider: 'claude',
  kelly: { enabled: false, scopes: [] },
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
export interface Decision { id: string; project_id: string | null; text: string; decided_at: string; from_meeting_id: string | null; at_ref: string | null; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number }
export type PushType = 'digest' | 'overdue' | 'nudge' | 'milestone' | 'weekly_review' | 'app_task' | 'meeting';

export type RaidType = 'risk' | 'assumption' | 'issue' | 'dependency';
export interface RaidItem {
  id: string; project_id: string; type: RaidType; text: string; probability: number | null; impact: number | null;
  response: string | null; owner: string | null; trigger: string | null; status: 'open' | 'closed'; due_at: string | null;
  from_meeting_id: string | null; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number;
}
export interface ChangeRequest {
  id: string; project_id: string; title: string; description: string | null; impact_scope: string | null; impact_time: string | null;
  impact_cost: string | null; decision: 'pending' | 'approved' | 'rejected'; approver: string | null; decided_at: string | null;
  created_at: string; updated_at: string; deleted_at: string | null; enc_v: number;
}
export interface Lesson { id: string; project_id: string; text: string; category: string | null; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number }
export type DocKind = 'pdf' | 'docx' | 'xlsx' | 'md' | 'txt';
export interface DocumentRow {
  id: string; name: string; kind: DocKind; size: number; content_type: string; project_id: string | null; is_template: number;
  placeholders: string[]; text_indexed: number; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number;
}
export interface LibraryPage { slug: string; section: string; title: string; body: string; source: 'bundled' | 'import' | 'lesson' }
export type Provider = 'claude' | 'gemini';
export type AiFeature = 'copilot' | 'status_report' | 'plan_review' | 'brief';
export interface ProposedTask { title: string; horizon: Horizon; due_at: string | null }
export interface ProposedRaid { type: RaidType; text: string; probability: number | null; impact: number | null }
export interface Proposals { tasks: ProposedTask[]; raid: ProposedRaid[]; decisions: { text: string }[] }
export interface AiThread { id: string; project_id: string | null; title: string; provider: Provider; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number }
export interface AiMessage {
  id: string; thread_id: string; role: 'user' | 'assistant'; provider: Provider | null; content: string; citations: string[];
  proposals: Proposals | null; cost_micro: number; saved: number; created_at: string; enc_v: number;
}

export interface ReportInput {
  project: Project; milestones: Milestone[]; tasks: Task[]; raid: RaidItem[]; changes: ChangeRequest[]; decisions: Decision[]; lessons: Lesson[];
  meetings: { id: string; title: string; received_at: string; summary: string | null }[];
}
/** table: "A | B" lines with a header line; list: "• …" lines; both '' when empty. */
export interface Section<R> { rows: R[]; count: number; table: string; list: string }
export interface ReportModel {
  generated_at: string; range: { from: string; to: string; label: string };
  project: { name: string; kind: string; status: string; phase: string; rag: string; rag_label: string; rag_reason: string; sponsor: string; start_at: string; end_at: string;
    objectives: string; scope_in: string; scope_out: string; success_criteria: string; budget_planned: string; budget_spent: string; budget_left: string; pct_done: number };
  milestones: Section<{ name: string; due_at: string; done_at: string; gate: string; state: 'Done' | 'Late' | 'Due this period' | 'Upcoming' }>;
  tasks: { done: Section<{ title: string; done_at: string }>; open: Section<{ title: string; status: string; due_at: string; waiting_on: string }>;
    overdue: Section<{ title: string; due_at: string; days_late: number }>; next: Section<{ title: string; due_at: string }> };
  risks: Section<{ text: string; probability: string; impact: string; score: number; owner: string; response: string; trigger: string }>;
  issues: Section<{ text: string; impact: string; owner: string; response: string }>;
  assumptions: Section<{ text: string }>; dependencies: Section<{ text: string; owner: string }>;
  changes: Section<{ id: string; description: string; title: string; decision: string; impact_scope: string; impact_time: string; impact_cost: string; approver: string; decided_at: string }>;
  decisions: Section<{ decided_at: string; text: string }>; decisions_needed: Section<{ title: string }>;
  lessons: Section<{ text: string; category: string }>; meetings: Section<{ title: string; date: string; summary: string }>;
  status: { headline: string; progress: string; next_steps: string };
  ai: { summary: string };
}

/** GET /api/export: every table the user wrote, decrypted, trashed rows included (deleted_at set). Rows are as stored (JSON columns stay text) minus enc_v. */
type Raw = Record<string, unknown>[];
export interface ExportBundle {
  exported_at: string; version: 1; settings: Settings;
  projects: Omit<Project, 'enc_v'>[]; milestones: Omit<Milestone, 'enc_v'>[]; tasks: Omit<Task, 'enc_v'>[]; task_events: Raw;
  raid_items: Omit<RaidItem, 'enc_v'>[]; change_requests: Omit<ChangeRequest, 'enc_v'>[]; decisions: Omit<Decision, 'enc_v'>[]; lessons: Omit<Lesson, 'enc_v'>[];
  meeting_reviews: Raw; inbox_items: Raw; rules: Raw; documents: Raw; library_pages: Raw; ai_threads: Raw; ai_messages: Raw;
}
