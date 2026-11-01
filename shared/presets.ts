import type { AiFeature } from './types.ts';

export type PresetId = 'rephrase_email' | 'executive_version' | 'optimize_spreadsheet' | 'review_document' | 'use_case' | 'plan_from_scope' | 'plan_review' | 'status_report' | 'exception_report' | 'escalation_note' | 'difficult_conversation' | 'retrospective' | 'estimation';

export const PRESETS: { id: PresetId; label: string; feature: AiFeature; wantsProposals: boolean; prompt: string }[] = [
  { id: 'rephrase_email', label: 'Rephrase email', feature: 'copilot', wantsProposals: false,
    prompt: "Rephrase the email Vlad gives you so it is clear, firm and friendly. Keep every fact, date and name as written. Return the email only, ready to send, in the language it was written in. Then add at most two lines of advice on tone or on what to watch before he sends it." },
  { id: 'executive_version', label: 'Executive version', feature: 'copilot', wantsProposals: false,
    prompt: 'Turn what Vlad gives you into an executive version of under 120 words. Lead with the decision needed. Then the RAG status (red, amber or green) with its reason, the ask with a date, the top risk and the next milestone. End with one line on what you left out and why.' },
  { id: 'optimize_spreadsheet', label: 'Optimize spreadsheet', feature: 'copilot', wantsProposals: false,
    prompt: 'Review the spreadsheet below and rank your findings. Tag each one Fix (it changes results), Speed or Tidy. Give the cell or range, and a before and after formula, using functions Excel 365 has (XLOOKUP, LET, FILTER, named cells). Give advice only: never claim to have changed the file, and say when the data was cut.' },
  { id: 'review_document', label: 'Review a document', feature: 'copilot', wantsProposals: true,
    prompt: 'Review the document below as a sceptical peer. Find the gaps and risks, the missing acceptance criteria and the unclear owners or dates. Cite the section or page number for each finding. Rank what to fix first, then list the next steps. Propose the tasks, risks and decisions that would close the gaps.' },
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
  { id: 'retrospective', label: 'Retrospective', feature: 'copilot', wantsProposals: true,
    prompt: 'Run a retrospective. Read the lessons, issues, decisions and changes in the project data and the lessons in the library pages. Group them into patterns: what went well, what went wrong and why, what repeats across projects. Cite the library page for each lesson you draw on, and say plainly when there are too few lessons to see a pattern. End with the three changes most worth making next time, and propose them as tasks or lessons.' },
  { id: 'estimation', label: 'Estimate this', feature: 'copilot', wantsProposals: false,
    prompt: 'Help Vlad estimate the work he describes. Break it into parts, then give each a three-point estimate (optimistic, likely, pessimistic) and the PERT expected value (O + 4L + P) / 6 with the standard deviation (P - O) / 6; add them up and give a range he can promise at about 80%. Name the analogies from his past projects or lessons you used, and mark every number you guessed. Ask for what is missing instead of inventing it.' },
];
