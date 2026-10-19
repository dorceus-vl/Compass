# Compass — DESIGN.md

*Lives at* `assets/brand/DESIGN.md`*. Every phase that draws a screen reads it first. Derived from Hollow's DESIGN.md.*

**The short version: Compass looks like Hollow, in ivory instead of amber.** Same ground colours, same typeface, same login layout. The accent and the badge colour change; the app inside is Compass's own.

## Colour tokens — copy these exactly

| Token | Value | Used for |
| --- | --- | --- |
| `--bg` | `#050507` | page ground |
| `--panel` | `#0B0B10` | cards, the login stage, side panels |
| `--field` | `#131319` | inputs, chips, secondary buttons |
| `--field-border` | `rgba(255,255,255,.09)` | field and panel borders |
| `--border-soft` | `rgba(255,255,255,.07)` | outer card border |
| `--text` | `#F2F1F7` | primary text |
| `--text-dim` | `#A9A7B8` | labels, secondary text |
| `--text-faint` | `#8A8899` | captions, metadata (5.9:1 on the ground) |
| `--accent` | `#EDE3C9` | **Compass Ivory** |
| `--accent-bright` | `#FFF7E3` | hover, links |
| `--accent-dim` | `#C9BB9A` | pressed, quiet accents |
| `--accent-rgb` | `237,227,201` | for `rgba()` glows and overlays |
| `--on-accent` | `#1A1608` | text ON an accent fill |
| `--ok` | `#3DDC84` | success, done |
| `--warn` | `#FF7A45` | warnings, due soon |
| `--danger` | `#FF4D5E` | errors, overdue, Empty Trash |

Source-app colours (a task's origin only, never as the accent):

| Token | Value |
| --- | --- |
| `--finance` | `#4A9EFF` |
| `--health` | `#46B87C` |
| `--hollow` | `#F5A524` |
| `--aura` | `#B8F03E` |
| `--kelly` | `#D6336F` |
| `--nightowl` | `#8B5CF6` |
| `--sonar` | `#3FD8C9` |

**Near-black on the accent.** Light ivory needs dark text, so buttons use `--on-accent`.

## Interface language

**The interface is English, everywhere.** Content is whatever the user writes, French or English.

## Type

- **Inter** — 400 to 900, from Google Fonts. Headings 800 with `letter-spacing: -0.6px`; body 400–600.
- **IBM Plex Mono** — 400 / 500, only for dates, percentages and counts.
- `-webkit-font-smoothing: antialiased` on `body`.

## Shape and spacing

| Element | Value |
| --- | --- |
| Login stage (outer card) | radius `28px`, `1180 × 720`, border `--border-soft` |
| Cards, dialogs | radius `14px` |
| Inputs, buttons | radius `12px`, padding `14px 16px` |
| Pills and toggles | radius `999px` |
| Icon buttons | `38px` circle, `44px` minimum for anything tapped |

Small caps labels are IBM Plex Mono 11px, `letter-spacing: 2.4px`, uppercase.

## The logo

The Knocturn Labs owl badge — the ring with KNOCTURNLABS.COM, the owl, "A Big_ Vlad Company", the compass — **unchanged in every respect except colour**: the coloured pixels turned ivory, the blacks untouched, so the ring reads as `--accent`. Save it as `assets/brand/compass-logo.png` (512×512). It appears in the login brand row at 34px, the favicon, and the app icons.

## The login page

NightOwl's login rebuilt exactly, in ivory, **signing in through Knocturn ID at `id.knocturnlabs.com`**: the Login pill, the brand row (34px badge + `COM`/`PASS`), `h1` "Where to next" at 32px/800, email and password, "Forgot password?" in accent, the full-width accent button, then the TOTP step. Footer pinned with `margin-top: auto`: "Session kept for 72 hours · Knocturn ID". Below 900px the columns stack.

## Accessibility

Text at 4.5:1 (3:1 at 24px+); real buttons, links and labelled inputs; `aria-label` on every icon-only button; focus ring `border-color: var(--accent)` plus `box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.18)`; tap targets 44px minimum. Status colours never rely on colour alone.
