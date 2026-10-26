import type { Snapshot, SlipSummary } from './baseline.ts';
import type { DashboardMetrics } from './dashboard.ts';
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
  /** v2.4: the program it belongs to (same kind), the forecast at completion and the currency of its three budget numbers (ISO 4217). */
  program_id: string | null; budget_forecast: number | null; currency: string;
  created_at: string; updated_at: string; deleted_at: string | null;
}
/** v2.4: a program groups projects of one kind. name, rag_reason and notes are sealed for work; kind is fixed after creation. */
export interface Program {
  id: string; kind: Kind; name: string; rag: Rag; rag_reason: string | null; notes: string | null; sort: number; enc_v: number;
  created_at: string; updated_at: string; deleted_at: string | null;
}
/** v2.5: time on a task (task_id) or straight on a project (project_id, with a note); a running timer has ended_at null. kind is copied at creation (T2); note sealed for work. */
export interface TimeEntry {
  id: string; task_id: string | null; project_id: string | null; kind: Kind; started_at: string; ended_at: string | null; note: string | null;
  source: 'timer' | 'manual' | 'widget'; auto_stopped: number; enc_v: number; created_at: string; updated_at: string; deleted_at: string | null;
}
/** GET /api/programs/:id/detail (P3): the latest live baseline of each member (opened), the top 10 open risks by probability x impact, pending changes per member. */
export interface ProgramDetail {
  program: Program;
  baselines: { project_id: string; snapshot: Snapshot; taken_at: string }[];
  risks: { id: string; project_id: string; title: string; probability: number | null; impact: number | null }[];
  pending_changes: { project_id: string; n: number }[];
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
  /** v2.1: JSON array of task ids this one waits on (shared/deps.ts); JSON array of { id, text, done } (Task 1). Both null when empty. */
  blocked_by: string | null; checklist: string | null;
  sort_in_column: number; tags: string; enc_v: number; created_at: string; updated_at: string; deleted_at: string | null;
}
export interface TaskEvent { id: string; task_id: string; at: string; actor: 'you' | 'rule' | 'kelly' | 'meeting'; type: 'created' | 'moved' | 'edited' | 'comment' | 'nudged' | 'done'; data: string | null; enc_v: number }
export interface Settings {
  day_start_hour: number; digest_hour: number; quiet_from: string; quiet_to: string; weekly_review_day: number;
  wip_limits: Record<Status, number | null>; saved_views: { name: string; query: string }[]; tz: string;
  push: Record<PushType, boolean>; work_email_domains: string[]; last_review_at: string | null;
  ai_monthly_cap_micro: number; default_provider: Provider;
  /** What Kelly's agent API may do (changed only through PUT /api/kelly, never PATCH /api/settings). Off by default. `at` is the last change: the relay caches are keyed on it, so a change starts them afresh. */
  kelly: { enabled: boolean; scopes: AgentScope[]; at?: string };
  /** Athena: her ElevenLabs voice and whether answers are spoken (Task 4), and the id of her still portrait (set by POST/DELETE /api/athena/portrait). */
  athena: { voice_id: string | null; speak_answers: boolean; portrait_id: string | null };
  /** iPhone and iPad widgets (v2.3, W8): on the Lock Screen a work task shows as "Work task" while this is on. */
  widgets: { hide_work_on_lock: boolean };
  /** Workload (v2.4, P9): weekly capacity in hours, the hours in a working day (for "1d" estimates), the estimate a task without one counts as, and per-week overrides keyed by Monday. */
  workload: { work_hours: number; personal_hours: number; day_hours: number; default_estimate_minutes: number; overrides: Record<string, { work: number; personal: number }> };
}
/** One of Athena's avatar loops (Settings → Athena). The file is served by GET /api/athena/media/:id. */
export type AthenaClipState = 'idle' | 'listening' | 'thinking' | 'speaking';
export interface AthenaClip { id: string; state: AthenaClipState; name: string; bytes: number; created_at: string }
export type AgentScope = 'compass:read.tasks' | 'compass:write.tasks' | 'compass:read.projects' | 'compass:read.knowledge';
export const DEFAULT_SETTINGS: Settings = {
  day_start_hour: 6, digest_hour: 7, quiet_from: '22:00', quiet_to: '07:00', weekly_review_day: 0,
  wip_limits: { new: null, progress: 5, hold: null, waiting: null, done: null }, saved_views: [], tz: 'America/Toronto',
  push: { digest: true, overdue: true, nudge: true, milestone: true, weekly_review: true, app_task: true, meeting: true, unblocked: true, stakeholder: true, timer: true },
  work_email_domains: ['bell.ca'], last_review_at: null, ai_monthly_cap_micro: 20000000, default_provider: 'claude',
  kelly: { enabled: false, scopes: [] },
  athena: { voice_id: null, speak_answers: false, portrait_id: null },
  widgets: { hide_work_on_lock: true },
  workload: { work_hours: 40, personal_hours: 8, day_hours: 8, default_estimate_minutes: 60, overrides: {} },
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
  series_id?: string | null; // v2.1: the meeting series (shared/series.ts)
}
export interface Decision { id: string; project_id: string | null; text: string; decided_at: string; from_meeting_id: string | null; at_ref: string | null; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number }
export type PushType = 'digest' | 'overdue' | 'nudge' | 'milestone' | 'weekly_review' | 'app_task' | 'meeting' | 'unblocked' | 'stakeholder' | 'timer';

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
export type DocKind = 'pdf' | 'docx' | 'xlsx' | 'md' | 'txt' | 'csv' | 'pptx' | 'png' | 'jpg';
export interface DocumentRow {
  id: string; name: string; kind: DocKind; size: number; content_type: string; project_id: string | null; is_template: number;
  placeholders: string[]; text_indexed: number; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number;
}
/** Phase 6 Knowledge. Rows are as the API returns them: sealed columns opened (name, title, text, locator). */
export type KnowledgeScope = 'work' | 'personal';
export type KnowledgeBoundary = 'cloud' | 'locked';
export type KnowledgeSource = 'upload' | 'meeting' | 'email' | 'athena' | 'app:compass' | 'app:finance' | 'app:health' | 'app:home' | 'app:hollow';
export interface KnowledgeCollection {
  id: string; name: string; scope: KnowledgeScope; boundary: KnowledgeBoundary; system: number;
  created_at: string; updated_at: string; deleted_at: string | null; enc_v: number; item_count?: number;
}
export interface KnowledgeItem {
  id: string; collection_id: string; document_id: string | null; /** the meeting review or inbox item it was saved from (KN16) */ source_id: string | null; source: KnowledgeSource; title: string; state: 'indexing' | 'ready' | 'failed'; error: string | null;
  chunk_count: number; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number;
  /** Only on the item list: a ready Cloud AI item that meaning-search can't find right now (`reindexing`: the embedder will take it; `excluded`: its project is Offline-only or its file is in Trash). */
  search?: 'reindexing' | 'excluded';
  /** A failed item some of whose passages hold vectors (and are searched): the list says "Indexed in part" (KN22). */
  partial?: boolean;
}
export interface KnowledgeChunk { id: string; item_id: string; collection_id: string; ord: number; locator: string; text: string; embedded: number; created_at: string; enc_v: number }
export interface LibraryPage { slug: string; section: string; title: string; body: string; source: 'bundled' | 'import' | 'lesson' }
export type Provider = 'claude' | 'gemini';
/** Model features, Athena's voice (ElevenLabs text-to-speech) and listening (speech-to-text), and knowledge embeddings (Workers AI), metered the same way. */
export type AiFeature = 'copilot' | 'status_report' | 'plan_review' | 'brief' | 'athena_voice' | 'athena_listen' | 'knowledge_embed';
export interface ProposedTask { title: string; horizon: Horizon; due_at: string | null }
/** One task Athena proposes from a forwarded email (Task 4b); lives in the client until Vlad accepts it. */
export interface SplitProposal { title: string; due_at: string | null; horizon: Horizon; notes: string | null }
export interface ProposedRaid { type: RaidType; text: string; probability: number | null; impact: number | null }
export interface Proposals { tasks: ProposedTask[]; raid: ProposedRaid[]; decisions: { text: string }[] }
/** `kind` (KN2) is set only on a project-less thread ('work' from "No project (work)"); null means the project's kind, or personal without one. It never changes. */
export interface AiThread { id: string; project_id: string | null; kind: Kind | null; title: string; provider: Provider; created_at: string; updated_at: string; deleted_at: string | null; enc_v: number }
export interface AiMessage {
  id: string; thread_id: string; role: 'user' | 'assistant'; provider: Provider | null; content: string; citations: string[];
  proposals: Proposals | null; cost_micro: number; saved: number; created_at: string; enc_v: number;
}

export interface ReportInput {
  project: Project; milestones: Milestone[]; tasks: Task[]; raid: RaidItem[]; changes: ChangeRequest[]; decisions: Decision[]; lessons: Lesson[];
  meetings: { id: string; title: string; received_at: string; summary: string | null }[];
  /** v2.2: the project's latest live baseline, opened (name and snapshot); null or absent when there is none. Tasks include subtasks, so slip can compare them. */
  baseline?: { name: string; taken_at: string; snapshot: Snapshot } | null;
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
  /** v2.2 (C5): the latest baseline against the plan now. `has_baseline` false means there is none and the rest is empty. */
  schedule: {
    has_baseline: boolean; baseline_name: string; taken_at: string; summary: SlipSummary | null; line: string;
    late_milestones: Section<{ name: string; baseline_due: string; due_at: string; days_late: number }>;
  };
  /** v2.2 (C5): numbers only, as of `as_of` (today, not the report period). `line` is the one-sentence form used in the report; the numbers are what Athena's summary request carries. */
  metrics: DashboardMetrics & { as_of: string; line: string };
  ai: { summary: string };
}

/** GET /api/export: every table the user wrote, decrypted, trashed rows included (deleted_at set). Rows are as stored (JSON columns stay text) minus enc_v. */
type Raw = Record<string, unknown>[];
export interface ExportBundle {
  exported_at: string; version: 1; settings: Settings;
  projects: Omit<Project, 'enc_v'>[]; milestones: Omit<Milestone, 'enc_v'>[]; tasks: Omit<Task, 'enc_v'>[]; task_events: Raw;
  raid_items: Omit<RaidItem, 'enc_v'>[]; change_requests: Omit<ChangeRequest, 'enc_v'>[]; decisions: Omit<Decision, 'enc_v'>[]; lessons: Omit<Lesson, 'enc_v'>[];
  meeting_reviews: Raw; inbox_items: Raw; rules: Raw; documents: Raw; library_pages: Raw; ai_threads: Raw; ai_messages: Raw;
  knowledge_collections: Raw; knowledge_items: Raw; knowledge_chunks: Raw;
  /** v2.1 */
  templates: Raw; meeting_series: Raw;
  /** v2.2 */
  baselines: Raw; stakeholders: Raw;
  /** v2.4 */
  programs: Raw;
  /** v2.5 */
  time_entries: Raw;
}
