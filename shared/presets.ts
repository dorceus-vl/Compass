import type { AiFeature } from './types.ts';

export type PresetId = 'use_case' | 'plan_from_scope' | 'plan_review' | 'status_report' | 'exception_report' | 'escalation_note' | 'difficult_conversation';

export const PRESETS: { id: PresetId; label: string; feature: AiFeature; wantsProposals: boolean; prompt: string }[] = [
  { id: 'use_case', label: 'Work through a situation', feature: 'copilot', wantsProposals: true,
    prompt: 'Work through the situation Vlad describes. Start with a short diagnosis: what is really going on and what is still unknown. Then give two or three options, each with its trade-offs. Recommend one and turn it into a plan of dated tasks. Say who to inform and how (channel, tone, timing). Finish with the risks and issues worth logging.' },
  { id: 'plan_from_scope', label: 'Plan from scope', feature: 'copilot', wantsProposals: true,
    prompt: 'Turn the scope Vlad gives into a plan. Break it down (WBS) to work-package level. Give each package a three-point estimate (optimistic, likely, pessimistic) and the expected value. List the milestones with dates. Then propose the tasks for the first two weeks, in order, with dates.' },
  { id: 'plan_review', label: 'Review this plan', feature: 'plan_review', wantsProposals: true,
    prompt: 'Review the project data below as a sceptical peer. Find the gaps in the plan and the open items: risks nobody has logged, dates that look unrealistic, actions with no owner or no date, missing gates or decisions. Rank what you find and say what to fix first. Propose the tasks, risks and decisions that would close the gaps.' },
  { id: 'status_report', label: 'Status report', feature: 'status_report', wantsProposals: false,
    prompt: "Write this week's status report for the project. Give the overall RAG (red, amber or green) and the reason in one or two sentences. Then: progress since last week, next steps, risks and issues that matter, and the decisions needed from others. Keep it short enough to paste into an email." },
  { id: 'exception_report', label: 'Exception report', feature: 'copilot', wantsProposals: true,
    prompt: 'Write an exception report. The forecast is to break tolerance (time, cost, scope or quality). State the cause, the impact if nothing changes, the options with their trade-offs, and your recommendation. Be plain about what is known and what is a guess.' },
  { id: 'escalation_note', label: 'Escalation note', feature: 'copilot', wantsProposals: false,
    prompt: 'Draft a short escalation to a sponsor or a vendor manager. Lead with the ask. Then the impact if it does not happen, the deadline, and the options they have. Firm and courteous, no blame, no more than a screen of text.' },
  { id: 'difficult_conversation', label: 'Prepare a difficult conversation', feature: 'copilot', wantsProposals: false,
    prompt: 'Help Vlad prepare for a difficult conversation. Set out the goal, a calm opening line, the facts kept apart from the stories he is telling himself, the likely reactions with a good answer to each, and the next step to agree before the conversation ends.' },
];
