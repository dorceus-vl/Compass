---
title: Template guide: lessons learned
section: Templates
---
The lessons learned template builds a closing document (leçons apprises) from the project's Lessons tab and its record, and leaves the reflective parts for you to write with the team. You generate it from the Templates list on the project's Report tab, as Word, Markdown or PDF. This page also explains how to make your own Word template, so Compass can fill a document in your organisation's format. How to collect lessons during the project is in [[lessons-learned]].

## Project summary

Key facts from the project record, such as the sponsor, dates and budget.

- **Good**: check the planned and spent budget and the end date are final before generating, so the summary states what really happened.
- **Mistake**: closing the document with the original end date when the project finished two months later.

## What went well

Left blank. Fill it in at the closing session.

- **Good**: specific practices worth repeating, with why they worked: "Confirmation calls ten days before each install cut failed visits from twelve in wave 1 to one in wave 3."
- **Mistake**: compliments instead of practices ("great team spirit").

## What to improve

Left blank.

- **Good**: conditions, not culprits, each tied to an effect you can measure.
- **Mistake**: a list so long that nothing on it will be acted on. Keep the five that cost the most.

## Lessons

A table of every lesson on the Lessons tab, with its category.

- **Good**: lessons written so a PM who was not there can act on them, and a small, stable set of categories, so the next project can find them.
- **Mistake**: adding all the lessons on the last day; most of the useful ones are forgotten by then.

## Actions for next time

Left blank.

- **Good**: each important lesson turned into a change with an owner: a checklist item, a standard risk, a contract clause.
- **Mistake**: actions with no owner, which means the lesson was recorded but not learned.

## Making your own Word template

When your organisation has a standard format, you can upload a `.docx` that contains placeholders in double braces, and Compass fills it with the project's data.

1. In Word, write the document as usual and type each placeholder where its value should go, for example `{{project.name}}`.
2. Upload it on the project's Documents tab and turn on "Use as template". Compass lists the placeholders it found; check each one is spelled as below, because an unknown name is filled with nothing.
3. On the Report tab, under your templates, choose Fill. Compass fills it on your device with the data for the report's current period and downloads a Word file. If the template is broken, for example a loop that is never closed, Compass shows a message starting "Template problem".

Single values Compass fills:

| Group | Placeholders |
|---|---|
| Project | `project.` followed by name, kind, status, phase, rag, rag_label, rag_reason, sponsor, start_at, end_at, objectives, scope_in, scope_out, success_criteria, budget_planned, budget_spent, budget_left, pct_done |
| Status | `status.headline`, `status.progress`, `status.next_steps`, `ai.summary` |
| Period | `range.label`, `range.from`, `range.to`, `generated_at` |

Lists Compass fills. Each one offers `.table` (rows as text separated by vertical bars, with a header line), `.list` (bullet lines), `.count`, and `.rows` for a loop over these fields:

| List | Fields in each row |
|---|---|
| `milestones` | name, due_at, done_at, gate, state |
| `tasks.done` | title, done_at |
| `tasks.open` | title, status, due_at, waiting_on |
| `tasks.overdue` | title, due_at, days_late |
| `tasks.next` | title, due_at |
| `risks` | text, probability, impact, score, owner, response, trigger |
| `issues` | text, impact, owner, response |
| `assumptions` | text |
| `dependencies` | text, owner |
| `changes` | title, decision, impact_scope, impact_time, impact_cost, approver, decided_at |
| `decisions` | decided_at, text |
| `decisions_needed` | title |
| `lessons` | text, category |
| `meetings` | title, date, summary |

A loop opens with `#` and closes with `/`. Inside it, use the row's field names alone:

```
{{#lessons.rows}}{{category}}: {{text}}{{/lessons.rows}}
```

For a real Word table, build one row with a field in each cell, and put the opening tag in the first cell and the closing tag in the last cell; the row repeats once per item. `ai.summary` is filled only after you have had the copilot write the summary on the Report tab.

## In practice

- Add your project's lessons to the Lessons tab now, with categories, so the table is ready at closing.
- Generate the document before the closing session and bring it as the agenda.
- Turn the top three lessons into actions, each with an owner.
- Rebuild your team's usual closing template in Word with placeholders and fill it from one project.

## Related

- [[lessons-learned]]
- [[project-closing]]
- [[template-status-report]]
- [[meetings-and-governance]]
