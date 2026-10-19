---
title: Quality management
section: Contracts and quality
---
On a telecom project, poor quality rarely shows up on delivery day. It shows up three weeks after go-live, when a site drops every afternoon, the as-built records do not match what is in the rack, or the customer's first invoice is wrong. Quality management (gestion de la qualité) is about deciding in advance what "good" means for each deliverable, building the work so it gets there, and checking before the customer finds out.

## Quality planning: decide what good means

Before the work starts, for each major deliverable, answer:

- **Which standards apply?** The customer's requirements, the contract, Bell's engineering and security standards, vendor specifications, regulations.
- **How will we know it meets them?** Tests, inspections, reviews, measurements, with pass and fail thresholds.
- **Who checks, and when?** Ideally someone other than the person who did the work, and early enough to fix cheaply.
- **What records prove it?** Test results, signed checklists, photos of the install, configuration backups.

Write this as a short quality plan, or a section in the project plan. For an SD-WAN rollout it might list the site acceptance test (link up, failover, performance thresholds, monitoring visible in the operations tools), the documentation required per site, and who signs.

## Assurance vs control

The two are often confused, because both involve checking. They check different things.

**Quality assurance** (assurance qualité) looks at the way the work is done. Its question is: if we keep working like this, will the results be right? Examples: reviewing the method of procedure before the first cutover; checking that the install vendor's technicians are certified and use the agreed checklist; auditing whether test results are actually recorded; running a lessons session after the pilot sites. It is preventive, and it happens before and during the work.

**Quality control** (contrôle de la qualité) looks at the results. Its question is: does this deliverable meet its criteria? Examples: running the site acceptance test; inspecting cabling and labelling; reviewing the configuration against the design; sampling as-built records. It finds defects, so they can be fixed and their causes fed back to assurance.

A project that does only control finds the same defect at site after site. A project that does only assurance has good processes and no proof that the outputs work. You need both, and the link between them: every recurring defect found by control should change a process.

## Acceptance

Acceptance is the formal step where the person entitled to say "yes, this meets what we agreed" says it, in writing. Make it work by:

- agreeing the criteria in the statement of work or the charter, before delivery (see [[procurement-and-contracts]]);
- accepting in stages, such as per site or per wave, rather than all at the end;
- naming who signs, and how long they have, and what happens if nobody responds;
- recording any accepted deviation or punch-list item, with an owner and a date.

On customer projects, the customer's acceptance often triggers billing and the start of the service term, so it deserves as much planning as the cutover itself.

## Definition of done

In agile workstreams, the definition of done (définition de « terminé ») is the team's shared checklist that every backlog item must pass before it counts as finished. It is a quality commitment, not a wish list. For a portal or integration team it might include: code reviewed, automated tests passing, tested end to end with ordering and billing in a test environment, security scan clean, documentation updated, demo accepted by the product owner.

The same idea works outside software. A "done" checklist for a site install could include: equipment installed and labelled, tests passed and attached, as-built uploaded, customer contact signed, monitoring confirmed by operations. A task is only moved to done on the board when every line is true. When teams argue about whether something is done, the checklist is missing or unclear.

## In Compass

Write the acceptance criteria into the project's success criteria field and the definition of done into each relevant task's notes. Log quality risks and recurring defects in the RAID log, and the lessons they teach in the Lessons tab.

## In practice

- Write or update the acceptance test for your next deliverable, with pass and fail thresholds.
- Pick one assurance check, such as a method of procedure review, and schedule it before the next cutover.
- Draft a "done" checklist for your most repeated task, such as a site install, and agree it with the vendor.
- Look at the last five defects and ask which process would have prevented them.
- Confirm who signs customer acceptance, and how long they have.

## Related

- [[procurement-and-contracts]]
- [[vendor-management]]
- [[scrum-essentials]]
- [[project-closing]]
