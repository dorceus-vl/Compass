---
title: Procurement and contracts
section: Contracts and quality
---
Much of what a telecom project delivers is bought: equipment, installation crews, carrier circuits, software licences, specialist engineers. The contract decides what you can insist on when things go wrong, so the PM needs to understand it well, even when procurement (approvisionnement) and legal own the process. At Bell, as in most large organisations, purchasing follows set policies and approval levels; this page covers the concepts, not any internal procedure.

## Asking the market: RFI, RFP, RFQ

The three requests answer different questions:

| Request | French | The question it asks | When to use it |
|---|---|---|---|
| RFI, request for information | Demande d'information (or de renseignements) | What exists, and who can do it? | Early, when you are still shaping the solution |
| RFP, request for proposal | Demande de propositions | How would you solve this, and at what price? | When the need is clear but the solution is open |
| RFQ, request for quotation | Demande de prix | What is your price for exactly this? | When the specification is fixed, for example a list of equipment |

A frequent sequence on a large deal is an RFI to shortlist, then an RFP to the shortlist. An RFQ suits commodities where price and delivery are the only real differences. Whatever the type, write the evaluation criteria and their weights before the responses arrive, so the choice can be explained later.

## What a statement of work holds

The statement of work (énoncé des travaux) is where the vendor's job is defined. Disputes almost always trace back to something it left vague. A solid one covers:

- **Background and objectives**: why the work exists.
- **Scope**: the deliverables and services, and an explicit list of what is excluded.
- **Location and access**: sites, hours, who arranges access, safety requirements.
- **Schedule**: milestones, lead times, and what happens when the customer or Bell causes a delay.
- **Roles**: what the vendor provides and what Bell or the customer provides (power, rack space, escorts, configurations).
- **Standards**: technical specifications, documentation formats, security and privacy requirements.
- **Acceptance criteria**: how each deliverable is checked and who signs.
- **Reporting and governance**: status cadence, meetings, escalation contacts.
- **Service levels and remedies**: where they apply (see [[vendor-management]]).
- **Pricing and payment**: tied to milestones or acceptance where possible.
- **Change process**: how scope changes are requested, priced and approved.

## Contract types: who carries the risk

| Type | French | How the vendor is paid | Who carries the cost risk | Fits when |
|---|---|---|---|---|
| Fixed price | Prix forfaitaire | An agreed amount for the defined scope | Mostly the vendor | Scope is clear and stable |
| Time and materials | Temps et matériel | Hours at agreed rates, plus materials | Mostly the buyer | Scope is unclear or evolving, or for short expert help |
| Cost-plus | Prix coûtant majoré | Actual costs plus a fee, fixed or a percentage | Mostly the buyer | Novel or high-uncertainty work where a fixed price would be padded |

The trade-offs follow from the risk. A fixed price looks safe but pushes the vendor to read the scope narrowly and to charge for every change, so the statement of work has to be precise. Time and materials is flexible but needs a cap (a "not to exceed" amount) and close tracking of hours. Cost-plus needs audit rights and trust. Variants such as unit pricing (per site, per circuit) are common in rollouts and combine a fixed rate with a variable quantity.

## Acceptance criteria

Acceptance (acceptation) is the moment the buyer agrees the deliverable meets the contract, and often when payment is due. Good criteria are:

- **Measurable**: "all ports pass the agreed test plan, results attached", not "working to the customer's satisfaction".
- **Agreed upfront**, in the statement of work, not negotiated at delivery.
- **Owned**: who tests, who signs, and within how many days, with what happens if nobody signs.
- **Staged** where it helps: per site or per wave, so payment and problems do not pile up at the end.

Keep vendor and customer acceptance in step. If the vendor's work is finally accepted long before the customer accepts the service, defects found in between are Bell's to absorb; a held-back final payment or a warranty period covers the gap.

## In Compass

Keep the statement of work and the signed contract as project documents, log contract risks and vendor dependencies in the RAID log, and record award and acceptance decisions in Decisions.

## In practice

- Read the statement of work for your main vendor and list every deliverable without a measurable acceptance criterion.
- Write down the contract type and what that means for who pays when scope changes.
- Find the change clause and confirm how a change is priced and approved.
- Check what covers defects found between vendor acceptance and the customer's acceptance: a holdback, a warranty, or nothing.
- Agree with procurement the evaluation criteria for your next request before it goes out.

## Related

- [[vendor-management]]
- [[quality-management]]
- [[change-control]]
- [[charter-and-business-case]]
