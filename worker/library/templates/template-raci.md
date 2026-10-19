---
title: Template guide: RACI
section: Templates
---
The RACI template is the one built-in document that Compass deliberately leaves mostly empty. Compass knows your milestones, but it does not know who does what, and guessing would produce a matrix (matrice RACI) that looks finished and has been agreed by nobody. So it gives you the grid and leaves the letters to you and the people named in it. You download it from the Templates list on the project's Report tab, as Word, Markdown or PDF; Word is the useful one here, because you will edit it. For the meaning of each letter and the common traps, read [[raci-matrix]] first.

## Deliverables

The rows are the project's milestones. A project with no milestones gets five placeholder rows, Deliverable 1 to Deliverable 5.

- **Good**: rows that are results someone can sign off: a design, a site acceptance, a cutover plan, a handover pack, a go-live decision. Eight to fifteen rows is usually enough to cover the moments where accountability matters.
- **What to change**: milestones are events, and some of them are not deliverables ("pilot live" is an outcome of several deliverables). Rename such rows to the thing being produced or decided, split a row when two different people would sign its parts, and add rows for important decisions that are not milestones, such as a design change or a vendor substitution.
- **Mistakes**: rows that are activities ("weekly meeting", "testing"); fifty rows nobody will read.
- **Example**: "Wave 2 live" becomes two rows: "Wave 2 cutover plan" and "Wave 2 go / no-go".

## Roles

The columns are Sponsor, Project manager, Team, Vendor and Operations.

- **Good**: columns that match how your project is really organised. Split "Team" into the groups that actually do the work, such as solution architecture, provisioning and field services. On B2B work, add a column for the customer, because many deliverables need their input or signature.
- **Names or roles**: use roles in the columns and keep a short legend of who holds each role today. People change during a long rollout; roles rarely do.
- **Mistakes**: a column for every individual, which makes the table too wide to print; leaving out operations, who then refuse a handover they never agreed to.
- **Example**: Sponsor; Project manager; Solution architect; Provisioning; Install vendor; Customer IT; Operations.

## Filling the cells

Every cell starts blank. Fill them in a working session with the people named, not alone at your desk.

- **Good**: go row by row and ask the four questions: who does the work, whose name is on the result, who must be heard before it is final, and who needs to know afterwards. Then read down each column: a person with R's on half the rows is overloaded, and a column of only I's may not belong in the matrix.
- **Mistakes**: a C in every cell "to be inclusive", which slows every deliverable; the project manager as A on every row.
- **Example row**: "Handover to operations": Sponsor I, Project manager R, Solution architect C, Customer IT I, Operations A.

## One A per row

Compass prints a note under the table: one A per row. It is the rule that makes the matrix worth having.

- **Good**: every row has exactly one A, and that person has the authority to sign. If two people insist on the A, split the row by aspect (technical and commercial approval) or agree who breaks a tie.
- **Mistakes**: a row with no A, which tends to be the row that slips; two A's, which means a decision that bounces between two desks.
- **Check**: before sharing, scan the A's alone. Each one should be a name that person would recognise and accept.

## After the session

Save the agreed matrix with the project's documents. When a change moves an A, for example a new vendor takes over installation, record it in the Decisions tab and update the matrix the same week.

## In practice

- Generate the RACI for your current project and rename any row that is an event into the deliverable behind it.
- Add a customer column if the project has a customer.
- Book thirty minutes with the leads to fill the cells together.
- Check every row has exactly one A before sending it out.
- Put a review of the matrix on the agenda of the next phase-end meeting.

## Related

- [[raci-matrix]]
- [[stakeholder-management]]
- [[template-charter]]
- [[template-wbs]]
- [[vendor-management]]
