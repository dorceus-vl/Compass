# Compass Phase 3b (Redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Compass screen gets the direction Vlad chose on 2026-10-19: calm ivory-led colour with small source accents, a greeting card whose compass follows the cursor over floating shapes, a compass dial that spins the three horizons, task lists with the lens scroll effect and swipe-to-complete, the milestone line, and tilting project cards — so the app feels alive without becoming loud.

**Architecture:** Pure UI work in `web/`. One motion module (`web/src/motion.ts`: pure maths with self-checks, plus small React hooks that share a single `requestAnimationFrame` scroll loop) and a handful of new components (`TaskCard`, `Hero`, `HorizonDial`, `HorizonRing`, `MilestonePath`, `ProjectCard`, `SectionHead`) replace the plain rows. Screens adopt them task by task. No API, schema or data change, except reading the existing `projects.colour` column.

**Tech Stack:** As before (React 19, Vite, plain CSS with tokens). No new dependency: motion is CSS transforms, the View Transitions API where the browser has it, and hand-written hooks.

**Spec:** `docs/superpowers/specs/2026-10-19-compass-design.md` §6 (views) and §11 (platforms: keyboard first, 44px targets, focus rings, reduced motion); **visual reference: `docs/ui-directions.html` (round 3, published at https://claude.ai/artifact/Fac5x5Lj5byt1A2BGPkR9h)** — its CSS values (colours, radii, shadows, durations, easings, sizes) are the target; copy them, don't reinvent them.

## What Vlad asked for (2026-10-19)

- "Make it more professional": colour as accents (a 3px bar, an icon tile, dots on chips), not filled cards.
- Greeting card: the compass follows the cursor wherever it hovers; Prism's floating shapes behind it.
- Task lists: Aurora's lens effect (the card at the centre comes forward and lights up, the others tilt away) while scrolling.
- Keep from round 1: the "Good evening" card, the 3D horizon cards, the milestone line, the compass dial for short / medium / long.
- Apply it to every screen before Phase 4.

## Who does what

| # | Only Vlad | When | How long |
| --- | --- | --- | --- |
| 1 | Look at the screenshots in each task's report if you want, and say "deploy Compass" when the redesign is done (Task 9) | After Task 8 | 1 min |
| 2 | Try it on the Mac, the iPhone and the Android phone after deploy | Task 9 | 10 min |

## Global Constraints

- Everything from Phases 1–3 still holds (tokens from `assets/brand/DESIGN.md` only, English UI, no `alert/confirm/prompt`, `<dialog>` modals, no inline scripts or `on*=` (CSP), plain text never rendered as HTML, offline queue and step-up behaviour unchanged).
- No new dependency. No animation, gesture or 3D library.
- New tokens are added to `assets/brand/DESIGN.md` and `web/src/tokens.css` in Task 0 before any screen uses them; afterwards no screen invents a colour.
- `prefers-reduced-motion: reduce` turns every transform and animation off; the screen is complete and usable at rest (nothing waits at `opacity: 0`).
- Motion uses `transform` and `opacity` only. All scroll-linked effects run in one shared `requestAnimationFrame` loop with passive listeners; no layout read inside a write loop beyond `getBoundingClientRect` of the cards being styled.
- Every interactive element is at least 44 × 44 px at phone width (`@media (max-width:760px),(pointer:coarse)`), keyboard reachable with a visible focus ring; swipe gestures always have a button equivalent.
- Every screen works at 375 px and 1280 px without horizontal page scroll.
- No API, schema or worker change, except where a task says so explicitly.
- Each task ends with `npm run typecheck && npm run check && npm run build` passing, screenshots of the screens it touched at 375 px and 1280 px (local `npm run dev:worker` + `npm run dev`, dev login) in the report, and a commit.

## Rulings made while writing this plan

- **D1 The preview page is the visual spec.** Where the plan's words and `docs/ui-directions.html` disagree on a look (size, colour, timing), the page wins.
- **D2 Colour rules:** a task's accent is its source app's muted colour (Finance `#6FA8E8`, Health `#6DB98F`, Hollow `#D9A55A`, meetings `#6CC3BA`, email `#D8CFB6`, Home and Aura `#A9C76A`, Kelly `#C77A97`, Night Owl `#9D95C6`); a manual task takes its project's colour; a task with neither is `--text-dim`. A project's colour is its `colour` column when set, else one of six muted swatches picked by a stable hash of its id (`#C9BB9A`, `#7DB4AC`, `#9D95C6`, `#6FA8E8`, `#D9A55A`, `#6DB98F`). Horizons: short `#DDB46E`, medium `#7DB4AC`, long `#9D95C6`. RAG keeps green / amber / red, softened: `#5CC98B`, `#E39A62`, `#E0606C`.
- **D3 The lens effect** applies to vertical task lists (Today's feed, Upcoming, a project's open tasks, Inbox). Board columns, the List table and the Timeline keep their own layouts and get lift-on-drag and hover effects instead.
- **D4 Swipe right to complete** works with touch and mouse on task cards; the check button stays. Inbox items swipe right to keep and left to dismiss, with their buttons kept.
- **D5 The milestone line** appears on Today (the project with the nearest open milestone; hidden when there is none) and on each project's Overview.
- **D6 Page transitions** use the View Transitions API when present (a short cross-fade and slide); other browsers switch instantly.
- **D7 Sign-in** keeps the Knocturn ID layout from DESIGN.md (brand row, "Where to next", form) and gains the floating-shapes background and the cursor compass on wide screens.
- **D8 Projects get a colour picker** (the six swatches) on the project page, writing the existing `colour` column through the normal PATCH (it is already allowed by `PROJECT_CHECKS`).

## File map

| Path | Responsibility |
| --- | --- |
| `assets/brand/DESIGN.md`, `web/src/tokens.css` | New tokens: muted source and project colours, horizon colours, softened RAG, `--card`, motion durations and easings |
| `web/src/motion.ts`, `scripts/motion.test.ts` | Pure maths (lens factor, angle to a point, angle unwrap, spring step, project swatch hash) and hooks (`useReducedMotion`, `useScrollFrame`, `useLens`, `useTilt`, `confetti`) |
| `web/src/ui/colors.ts` | `taskColor(task, project)`, `projectColor(project)`, `HORIZON_COLOR` |
| `web/src/ui/TaskCard.tsx` | The task card (accent bar, icon tile, chips with dots, due, check, swipe-to-complete, confetti) |
| `web/src/ui/Hero.tsx`, `HorizonDial.tsx`, `HorizonRing.tsx`, `MilestonePath.tsx`, `ProjectCard.tsx`, `SectionHead.tsx` | Shared pieces |
| `web/src/views/*.tsx`, `web/src/views/project/*.tsx`, `web/src/ui/Shell.tsx`, `Palette.tsx`, `TaskSheet.tsx`, `dialogs.tsx`, `AddedStrip.tsx`, `web/src/app.css` | Screens adopting them |

---

### Task 0: Design tokens and the motion module

**Files:**
- Modify: `assets/brand/DESIGN.md` (a "Colour accents" and a "Motion" section), `web/src/tokens.css`
- Create: `web/src/motion.ts`, `web/src/ui/colors.ts`, `scripts/motion.test.ts`

**Interfaces (produces):**

```ts
// web/src/motion.ts — pure
export const lensFactor = (cardCenterY: number, viewportMidY: number, viewportH: number) => Math.max(0, 1 - Math.abs((cardCenterY - viewportMidY) / viewportH) * 2.4);
export const lensOffset = (cardCenterY: number, viewportMidY: number, viewportH: number) => (cardCenterY - viewportMidY) / viewportH;
/** Bearing from (cx, cy) to (px, py) in degrees: 0 = up, clockwise. */
export function angleTo(cx: number, cy: number, px: number, py: number): number;
/** The equivalent of `next` closest to `prev` (adds or removes whole turns), so a needle never spins the long way round. */
export function unwrap(prev: number, next: number): number;
/** One step of a damped spring: returns the new [position, velocity]. k = 0.08, damping = 0.78 match the preview. */
export function springStep(pos: number, vel: number, target: number, k?: number, damping?: number): [number, number];
/** Stable index 0..n-1 from a string (FNV-1a), for project swatches. */
export function hashIndex(s: string, n: number): number;
// hooks
export function useReducedMotion(): boolean;
/** Runs cb on every animation frame after a scroll or resize, and once on mount; one shared loop for the whole app. */
export function useScrollFrame(cb: () => void, deps: unknown[]): void;
/** Applies the lens effect (--f, opacity, transform) to every child matching `selector` inside ref. */
export function useLens(ref: { current: HTMLElement | null }, selector?: string): void;
/** Pointer tilt with a glare position (--gx, --gy) on the element; max degrees. */
export function useTilt(ref: { current: HTMLElement | null }, max?: number): void;
export function confetti(x: number, y: number, color: string): void; // 18 pieces, removed after 850 ms; no-op with reduced motion
```

```ts
// web/src/ui/colors.ts
export const HORIZON_COLOR: Record<'short' | 'medium' | 'long', string>;
export function projectColor(p: { id: string; colour: string | null }): string; // colour column, else swatch by hashIndex
export function taskColor(t: { source_app: string; project_id: string | null }, projects: { id: string; colour: string | null }[]): string;
export const PROJECT_SWATCHES: string[]; // the six from ruling D2
```

- [ ] **Step 1: Failing test `scripts/motion.test.ts`**: `lensFactor(500, 500, 1000) === 1`; `lensFactor(900, 500, 1000) === 0.04` (±1e-9); `lensFactor(2000, 500, 1000) === 0`; `angleTo(0, 0, 0, -10) === 0`; `angleTo(0, 0, 10, 0) === 90`; `angleTo(0, 0, 0, 10) === 180`; `angleTo(0, 0, -10, 0) === -90`; `unwrap(350, 10) === 370`; `unwrap(10, 350) === -10`; `unwrap(0, 180) === 180`; a spring from 0 to 100 after 200 steps is within 0.01 of 100 and never exceeds 130; `hashIndex('abc', 6)` is stable across calls and in 0..5; 1 000 random ids spread over all six indexes; `taskColor` of a Finance task is the Finance colour, of a manual task in a project with `colour` set is that colour, of a manual task with no project is `var(--text-dim)`.
- [ ] **Step 2:** Implement until it passes. Hooks: `useScrollFrame` keeps a module-level `Set` of callbacks and one `scroll`/`resize` listener that schedules a single `requestAnimationFrame`; `useLens` uses it and does nothing (and clears inline styles) with reduced motion; `useTilt` sets `transform` on `pointermove`, clears on `pointerleave`, and does nothing on `pointer: coarse` or reduced motion.
- [ ] **Step 3:** Tokens. `tokens.css` and DESIGN.md gain: `--card: #0E0E14`, the eight muted source colours (`--src-finance` …), the six swatches (`--swatch-1..6`), `--h-short/--h-medium/--h-long`, softened `--ok/--warn/--danger` (D2; keep the old names, change the values, and check every existing use still reads), `--ease-out: cubic-bezier(.2,.8,.2,1)`, `--ease-spring: cubic-bezier(.3,1.45,.4,1)`, `--dur-quick: .25s`, `--dur-move: .9s`. DESIGN.md's new "Colour accents" and "Motion" sections state rulings D2–D6 in two short paragraphs each.
- [ ] **Step 4: Commit** `Phase 3b Task 0: tokens and motion module`.

---

### Task 1: TaskCard and its use in every task list

**Files:**
- Create: `web/src/ui/TaskCard.tsx`
- Modify: `web/src/ui/TaskRow.tsx` (delete it once nothing imports it), `web/src/views/Today.tsx`, `Upcoming.tsx`, `web/src/views/Project.tsx` (open tasks), `web/src/app.css`

**Interfaces:** `<TaskCard task={Task} projects={Project[]} onOpen={(id) => void} />` — keeps every behaviour of `TaskRow` (done toggle via `completeTask` / `updateTask`, waiting and work chips, due tone from `fmtDue`, source link `open ↗`), and adds: `--tc` from `taskColor`, a 3px accent bar, a 38px icon tile (source letter or glyph: Finance `$`, Health `+`, Hollow `H`, meeting `◷`, email `@`, Home `⌂`, else the project's first letter), chips with coloured dots, swipe right ≥ 110 px to complete (pointer events, `touch-action: pan-y`, a green "Done ✓" reveal, `confetti` at the release point), and the lens variables (`--f`) styled exactly as `.tcard` in the preview.

- [ ] **Step 1:** Build `TaskCard` from the preview's `.tcard` CSS and swipe logic (as React, no `innerHTML`).
- [ ] **Step 2:** Replace `TaskRow` in Today (all horizons and overdue lists), Upcoming and a project's open tasks; wrap each list in a container with `useLens`.
- [ ] **Step 3:** Keyboard: Enter on the card title opens the task sheet; the check button completes; swiping is never the only way.
- [ ] **Step 4:** Check in the browser (desktop and phone width): lens while scrolling, swipe to finish (mouse and touch emulation), undo by tapping the check again, reduced motion (DevTools emulation) shows flat cards. Screenshots.
- [ ] **Step 5: Commit** `Phase 3b Task 1: task cards with lens and swipe`.

---

### Task 2: Today: greeting hero, horizon dial and ring, milestone line

**Files:**
- Create: `web/src/ui/Hero.tsx`, `HorizonDial.tsx`, `HorizonRing.tsx`, `MilestonePath.tsx`, `SectionHead.tsx`
- Modify: `web/src/views/Today.tsx`, `web/src/ui/AddedStrip.tsx`, `web/src/app.css`

**Interfaces:**
- `<Hero greeting stats={{ today: number; overdue: number; nextMilestone: { name: string; days: number } | null }} />` — the preview's hero: grid and floating shapes layers with pointer parallax, the compass (tick ring, N/E/S/W, the ivory badge `/icons/icon-512.png` at its centre, a pointer that follows the cursor through `angleTo` + `unwrap` + `springStep`, returns to north on leave), the `HEADING 000°` readout, the date eyebrow, "Good morning/afternoon/evening, Vlad" with the ivory sheen, counters that count up.
- `<HorizonDial value={Horizon} counts={Record<Horizon, number>} onChange />` and `<HorizonRing value={Horizon} tasks={Record<Horizon, Task[]>} onChange />` — linked by the parent: picking on either moves both (needle spring, ring rotation by the shortest way). Dial buttons are a `role="group"` of `aria-pressed` buttons; ring arrows are buttons; drag on the ring turns it.
- `<MilestonePath milestones={Milestone[]} today={string} />` — the preview's path: drawn on scroll (`useScrollFrame`), done green / next amber pulsing / ahead violet, labels anchored so the first and last never clip, a spark travelling along the drawn part; with more than 6 milestones it shows the next 6 around today.

- [ ] **Step 1:** Build the five components from the preview's CSS and script (React, no `innerHTML`; the SVG built with JSX).
- [ ] **Step 2:** Today's new order: Hero → Added-by-your-apps strip (restyled as small cards with source dots) → brief card (restyled) → Horizons (dial + ring) → "Overdue" (TaskCards) → the chosen horizon's TaskCards with the lens → Milestone line for the project with the nearest open milestone (title links to the project). The Personal / Work / All filter stays (a segmented control in the SectionHead).
- [ ] **Step 3:** Phone: the compass sits top-right at 150 px, no readout; the dial and ring stack; the ring swipes.
- [ ] **Step 4:** Check in the browser at both widths, with data (add a project with milestones and a dozen tasks in local dev); screenshots.
- [ ] **Step 5: Commit** `Phase 3b Task 2: Today redesign`.

---

### Task 3: Shell, navigation, palette, dialogs

**Files:** Modify `web/src/ui/Shell.tsx`, `Palette.tsx`, `dialogs.tsx`, `web/src/App.tsx`, `web/src/router.ts` (transition hook), `web/src/app.css`

- [ ] **Step 1: Rail:** the badge at the top (already the real one), each link an icon + label with an active indicator that slides between links (one absolutely positioned pill, `transform: translateY`), a hover lift. Icons: inline SVG in a small `Icon` map, stroke 1.75, ivory when active.
- [ ] **Step 2: Phone tab bar:** frosted glass (`backdrop-filter`), an active pill that slides, safe-area padding, the + quick-add button raised in the centre with the accent fill.
- [ ] **Step 3: Page transitions:** `navigate()` wraps the state change in `document.startViewTransition` when present (ruling D6), with a 180 ms cross-fade and 8 px slide in CSS (`::view-transition-old/new(root)`); reduced motion skips it.
- [ ] **Step 4: Palette (⌘K):** glass panel, results with coloured dots by kind (task colour, project colour, library ivory, document dim), the selected row highlighted with the accent, arrow keys as today.
- [ ] **Step 5: Dialogs and toasts:** glass surface, a short scale-in, focus trapped as today; toasts slide up from the bottom with a progress line.
- [ ] **Step 6:** Screenshots of the rail, the tab bar, the palette and a dialog at both widths. **Commit** `Phase 3b Task 3: shell, navigation, palette`.

---

### Task 4: Board, List, Upcoming, Timeline

**Files:** Modify `web/src/views/Board.tsx`, `List.tsx`, `Upcoming.tsx`, `Timeline.tsx`, `web/src/ui/Card.tsx`, `web/src/app.css`

- [ ] **Step 1: Board:** columns as dark panels with a header count and a thin WIP meter (fills toward the limit, amber at the limit, red over); cards with the task colour bar and icon tile; on drag the card lifts (scale 1.03, shadow, a 2° tilt following the pointer's horizontal speed) and the target column glows faintly; drop animates into place. Drag logic unchanged.
- [ ] **Step 2: List:** rows with the accent bar and dots, a sticky header, hover highlight; sort and group as today.
- [ ] **Step 3: Upcoming:** days as section heads with the weekday and date; TaskCards with the lens.
- [ ] **Step 4: Timeline:** bars filled with the task colour at 30% and a solid left cap, milestones as glowing diamonds in the project colour, the today line in ivory with a slow pulse, project rows labelled with a colour dot. Drag and resize unchanged.
- [ ] **Step 5:** Screenshots of the four screens at both widths. **Commit** `Phase 3b Task 4: board, list, upcoming, timeline`.

---

### Task 5: Projects and the project page

**Files:** Create `web/src/ui/ProjectCard.tsx`; modify `web/src/views/Portfolio.tsx`, `Projects.tsx`, `Project.tsx`, `web/src/views/project/*.tsx`, `web/src/app.css`

- [ ] **Step 1: ProjectCard** from the preview's `.pcard` (tilt and glare via `useTilt`, RAG pill, % ring, next milestone, open and high risks, a colour dot from `projectColor`); the portfolio grid uses it.
- [ ] **Step 2: Project header:** a compact hero band (project colour as a faint gradient edge, name, kind and status, RAG pill with reason, the % ring, next milestone), the colour picker (ruling D8: six swatches as `aria-pressed` buttons, PATCH `colour`).
- [ ] **Step 3: Tabs:** a sliding active pill like the rail; on phones the bar scrolls sideways and keeps the active tab in view.
- [ ] **Step 4: Overview:** the MilestonePath above the milestones list; open tasks as TaskCards with the lens; the record fields in quiet cards.
- [ ] **Step 5: RAID, Changes, Decisions, Lessons, Meetings, Documents, Report, Copilot tabs:** rows as cards with the right accent (RAID: the score colour; Changes: decision colour; Decisions and Lessons: project colour), the heat grid restyled with glowing cells, buttons and inputs on the new surfaces. Behaviour unchanged.
- [ ] **Step 6:** Screenshots of the portfolio and every project tab at both widths. **Commit** `Phase 3b Task 5: projects and project page`.

---

### Task 6: Inbox, Meetings, meeting review, weekly review, rules, Trash

**Files:** Modify `web/src/views/Inbox.tsx`, `Meetings.tsx`, `Meeting.tsx`, `Review.tsx`, `Rules.tsx`, `Trash.tsx`, `web/src/app.css`

- [ ] **Step 1: Inbox:** items as cards with the source colour and icon tile; swipe right to keep (green reveal), left to dismiss (dim reveal) (ruling D4), buttons kept; the keyboard shortcuts unchanged; the lens on the list.
- [ ] **Step 2: Meetings and the meeting review:** each meeting a card with the meetings colour; the review's action items, decisions and open questions as cards with toggles; accepting animates the accepted items out.
- [ ] **Step 3: Weekly review:** the steps as a horizontal progress track that fills as each step is done; the final Done gives a short confetti.
- [ ] **Step 4: Rules and Trash:** cards on the new surfaces; Trash groups with counts.
- [ ] **Step 5:** Screenshots. **Commit** `Phase 3b Task 6: inbox, meetings, review, rules, trash`.

---

### Task 7: Library, Copilot, Settings, Sign-in

**Files:** Modify `web/src/views/Library.tsx`, `LibraryPage.tsx`, `Copilot.tsx`, `Settings.tsx`, `SignIn.tsx`, `web/src/ui/Markdown.tsx` (styles only), `web/src/app.css`

- [ ] **Step 1: Library:** sections as cards with a count; search results with highlighted snippets; the page view as a reading column (65 characters, comfortable leading), headings with an ivory rule, tables styled.
- [ ] **Step 2: Copilot:** the conversation as bubbles (yours right, ivory tint; the copilot left, card surface), citation chips with a book glyph, proposals as a card list with checkboxes, the typing indicator as three ivory dots with a stagger, the composer as a raised glass panel, the locked project label (already added) styled as a chip.
- [ ] **Step 3: Settings:** sections as cards with an icon and a one-line description; the phone "More" list as large rows with icons.
- [ ] **Step 4: Sign-in** (ruling D7): the Knocturn ID layout stays; the left stage gets the floating shapes and the cursor compass (`Hero`'s compass only) on wide screens.
- [ ] **Step 5:** Screenshots. **Commit** `Phase 3b Task 7: library, copilot, settings, sign-in`.

---

### Task 8: Accessibility, performance and the screen audit

**Files:** whatever the audit finds; `scripts/smoke.sh` unchanged unless a check needs it

- [ ] **Step 1:** Every screen at 375 px and 1280 px: no horizontal scroll, nothing clipped, 44 px targets (including the older ones listed as deferred in Phase 3: the project name input, the meeting review's Dismiss / Accept / project select, older Settings controls).
- [ ] **Step 2:** Reduced motion on every screen: flat and complete.
- [ ] **Step 3:** Keyboard pass: every action reachable, focus visible, the palette and dialogs trap focus.
- [ ] **Step 4:** Performance: Chrome's Performance panel while scrolling Today with 40 tasks shows no long tasks over 50 ms from the scroll loop; the JS bundle grows by less than 40 KB gzipped over `main`.
- [ ] **Step 5:** `npm run typecheck && npm run check && npm run build && npm run smoke` against local dev. A contact sheet of every screen (both widths) in the report. **Commit** `Phase 3b Task 8: audit fixes`.

---

### Task 9: Deploy (Vlad's word) and live check

- [ ] **Step 1:** Stop and ask Vlad ("deploy Compass").
- [ ] **Step 2:** After his yes: note the live version, `npm run deploy`, check `/`, `/sw.js` headers and one scheduled run; the service worker's cache name changes with the build, so devices pick up the new UI on their next visit.
- [ ] **Step 3:** Write `docs/phase-3b-verification.md` and commit.

---

## Spec coverage (self-review)

| Requirement | Task |
| --- | --- |
| Vlad: calmer, professional colour (accents, not fills) | 0, 1, all screens |
| Vlad: greeting card with the compass following the cursor over floating shapes | 2 (and 7 for sign-in) |
| Vlad: Aurora lens effect on task lists | 0, 1, 2, 4, 5, 6 |
| Vlad: horizon dial + 3D horizon cards; milestone line | 2, 5 |
| Vlad: every screen before Phase 4 | 1–7, audited in 8 |
| Spec §11: keyboard first, 44px, focus rings, reduced motion | Global constraints, 8 |
| Spec §6 views unchanged in function | every task ("behaviour unchanged") |

Not in this phase: native shells and push (Phase 4), new features or data, a light theme.
