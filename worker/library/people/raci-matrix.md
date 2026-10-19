---
title: The RACI matrix
section: People
---
When two people both think they own a deliverable, the work gets done twice or argued about. When each thinks the other owns it, it does not get done at all. A RACI matrix (matrice RACI) settles this before it happens: deliverables or decisions down the side, roles across the top, and one letter in each cell that matters.

## The four letters, as four questions

For each row, ask:

- **R: who is doing the work?** The person or team producing the deliverable. There can be several, but if there are more than two or three, the row is probably too big.
- **A: whose name is on it?** The one person who answers for the result, signs it off and makes the call when the R's disagree. They may also be an R.
- **C: whose input do we need before it is final?** People consulted in both directions, before the work is finished. Every C adds time, so add them on purpose.
- **I: who needs to know once it is done?** People informed after the fact, in one direction. They do not get a veto.

## One A per row

This is the rule that gives the matrix its value. Two A's on a row means nobody is accountable; the decision bounces between them, usually at the worst moment. If two people genuinely share a decision, split the row ("design approval: technical" and "design approval: commercial") or name a tiebreaker.

The A must also have the authority to match. Making a junior engineer accountable for a deliverable that needs a vendor's signature is setting them up to fail.

## A short telecom example

| Deliverable | Sponsor | PM | Solution architect | Install vendor | Customer IT | Operations |
|---|---|---|---|---|---|---|
| High-level design | I | C | A/R | C | C | C |
| Site survey reports | | I | C | R | C | |
| Cutover plan per wave | I | A | C | R | C | C |
| Go-live decision | A | R | C | I | C | C |
| Handover to operations | I | R | C | | I | A |

Read it down the columns as well as across the rows. A column full of R's is an overloaded person. A column of nothing but I's may be someone who should not be on the distribution list at all.

## Common mistakes

- **Everyone is a C.** It feels inclusive and grinds every deliverable to a halt. Ask "what would change if we did not ask them?"
- **Rows that are activities, not results.** "Attend weekly meeting" is not a deliverable. Use outcomes: "signed site acceptance".
- **No A on a row.** That is usually the row that will slip.
- **The PM as A on everything.** The PM is accountable for the plan and the process, not for every technical decision. Put the A where the expertise and authority sit.
- **Built once and filed.** People join and leave, vendors change. Review the matrix at each phase and whenever a role changes hands.
- **Agreed by nobody.** A RACI written by the PM alone is a guess. Walk it through with the people named and get their nod, especially for every A.

## RACI vs RASCI

Some organisations add **S, support**: people who help the R's with resources or specialist work, without owning the result. On a telecom rollout that might be the logistics team shipping equipment or a security group running a scan. It is useful when a lot of supporting work would otherwise be invisible, and adds clutter when it is not. Variants such as RACI-VS (verify, sign) or DACI (driver, approver) exist for the same reason: pick one and use it consistently across the project.

## In Compass

Compass generates a RACI template from the project: its milestones become the rows (or five blank deliverables when there are none) and the columns are sponsor, project manager, team, vendor and operations, ready for you to fill in. Keep the agreed version with the project, and record in Decisions any RACI change that moves an A.

## In practice

- List the ten deliverables or decisions most likely to cause friction on your project and build the matrix for them.
- Check every row has exactly one A, and that each A has the authority to sign.
- Read each column and rebalance any person with more than four R's.
- Walk the matrix through with the vendor and the customer's IT lead and get their agreement.
- Remove at least two C's that add delay without changing outcomes.

## Related

- [[stakeholder-management]]
- [[meetings-and-governance]]
- [[vendor-management]]
- [[wbs-and-scheduling]]
