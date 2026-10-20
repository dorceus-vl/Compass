---
title: Status reporting and RAG
section: Reporting
---
A status report (rapport d'état) has one job: to let its readers decide whether they need to do anything. Most reports fail at it by describing activity instead of position. "Team worked on site surveys" is activity. "Surveys are 18 of 25 done, two sites blocked on landlord access, wave 2 still on track for the 30th" is position. Write for the second.

## RAG that means something

Red, amber, green is useful only when everyone reads the colours the same way. Without definitions, green means "I'd rather not discuss it" and red appears only when it is too late. Agree thresholds with the sponsor at the start and print them on the report.

An example set, tied to the project's tolerances:

| RAG | Schedule | Cost | Scope and quality | What it asks of the reader |
|---|---|---|---|---|
| **Green** | Every committed milestone forecast on time or up to 5 working days late | Forecast no more than 5% over budget | As agreed | Nothing |
| **Amber** | A committed milestone forecast 6 to 15 working days late, with a recovery plan the team can carry out | Forecast more than 5% and up to 10% over | A change is pending, or a quality problem is being fixed | Awareness; maybe a small decision |
| **Red** | A committed milestone forecast more than 15 days late, or no credible recovery plan | Forecast more than 10% over | A deliverable will not meet the agreed scope or quality | Action or a decision from the sponsor or steering committee |

The numbers above are illustrations; set yours to match the project's tolerances. Three rules keep RAG honest:

- **Rate the forecast, not the past.** A project that was late but has a credible plan to recover can be amber. One that is on time today but will miss next month's milestone is already amber or red.
- **Always give the reason** in one line next to the colour.
- **Show the trend**: better, same or worse since last time. Amber getting worse needs more attention than a steady amber.

Never go from green straight to red if you could have seen it coming. That is the one thing executives remember.

## The sections of a status report

1. **Overall status**: RAG, reason and the reporting period.
2. **Executive summary**: three to five sentences. Where we are, what changed, what we need.
3. **Progress**: what was finished this period, as results.
4. **Next steps**: what is due in the next two weeks.
5. **Milestones**: name, planned date, forecast or actual, and a state such as done, late, due this period or upcoming.
6. **Risks and issues**: the top few only, with owner and response.
7. **Decisions needed**: what, from whom, by when.
8. **Decisions made**: so the record is complete.

Optional, depending on the audience: budget (planned, spent, forecast), change requests, earned value (see [[earned-value]]).

## Writing for executives

- **Lead with the ask.** If you need a decision, put it in the first two lines, not on page three.
- **One page.** Details go in an appendix or the working group.
- **Numbers over adjectives.** "Three days late" rather than "slightly delayed".
- **No surprises.** Anything red should have been raised by phone before the report goes out.
- **Same format every time**, so readers know where to look and can compare weeks.
- **Plain language, no internal jargon** about tools and ticket numbers. Use the customer's name for things.
- **In the reader's language.** For French-speaking executives, a French report reads as respect, not a courtesy.

## In Compass

Set the project's RAG and its reason on the project page; the portfolio shows them with % done, the next milestone, open and high risks, and pending changes for every active project. The Report tab builds the status report from the project's own data for a period (this week, the last two weeks, this month or custom dates), with the sections above, and exports it to Word, Markdown or PDF. On a project that allows cloud AI, "Write the summary with Athena" drafts the executive summary; otherwise the summary is the progress line, which you can edit in Word.

## In practice

- Write RAG thresholds for your project and get the sponsor to agree them by email.
- Rewrite last week's progress section as results, with numbers.
- Put the decisions you need in the first two lines of your next report.
- Add the trend (better, same or worse) to your next report, and to the RAG reason in Compass.
- Check that every red or amber item in the report has an owner and a date.

## Related

- [[exception-reports]]
- [[communication-management]]
- [[meetings-and-governance]]
- [[earned-value]]
