---
title: Ribbon system and card theme
status: implemented
workstream: theme-polish
issues:
  - ../../../issues/closed/code-quality/2026-10-15-themed-file-card-unit-layout.md
---
# Ribbon system and card theme

Make the approved Ribbon study available in the existing system and card theme
pickers. Preserve its flowing rust, amber and green bands and unpatterned tabs.

**Issues addressed:** The finish-time ThemedFileCard layout issue was fixed in
the same theme-polish work. Searched the theme issue cluster: box-authored themes
and the closed catalog decision concern extension contracts, outside this theme.

## Design

### Situations

- When opening my notes, I want the approved warm colors and flowing shapes so
  the workspace feels like a place I chose.
- When reading a long reply, I want legible text even where colored bands pass
  behind it, so I can stay with the conversation.
- When I have chosen another theme, I want that choice to stay in effect.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Choose Ribbon | Show | Existing system/card pickers | Waits to be found |
| Read and chat | Show | Workspace, card, transcript, composer | Background |
| Another theme selected | Quiet | Existing choices | Unchanged |

### Spirit

Serves “feel like a place” and “playful.” Risks decoration competing with reading;
keep cards opaque and check chat contrast over the darkest bands.

### Trust

Selection is the existing explicit setting action. No automatic selection or
notification. This work changes no agent authority.

### When it goes wrong or does nothing

Existing theme validation and source labels remain. Use default or another theme
reverses selection. Unknown system choices retain the resolver's problem report.

### Walkthrough

Choose Ribbon in Settings. The existing presentation mutation persists
`{name: ribbon, stock: flow}`. The provider applies its chrome attribute;
unthemed cards inherit Ribbon, explicit card themes keep their own material.
Reload restores selection. Choosing another theme removes Ribbon's scoped CSS.

## Smallest fix and budget

One catalog entry, stylesheet and original SVG; import, docs, resolver assertions
and a focused tour. Estimated 240–330 source lines, 55–80 test/fixture lines,
15–25 current-doc lines. Reuse the studio and sample chat from Bloom. No engine
or schema change. Existing uncommitted Bloom/studio work is a separate checkpoint.

## Stated preferences this plan trades against

The human approved revision 4 with “go for it with ribbon.” The preceding request
asked to remove the tab-top pattern and recover richer color flow. Preserve the
approved asymmetric controls, simple card edge and translucent reply treatment.
Adjust opacity only if needed for contrast; no new aesthetic variants.

## What already exists

- `src/shared/card-theme/catalog.ts:1`: `export const THEME_CATALOG = [` supplies
  picker choices. Add one entry using the existing pairing fields.
- `src/frontend/src/themes/bloom.css:26`: `isolation: isolate;` supports one
  decorative layer. Reuse this architecture, not its pastel appearance.
- `src/frontend/src/themes/chrome.css:190`: `.bbx-box-presentation .bbx-conversation-desk`
  paints the shared desk. Ribbon clears nested desk backgrounds like Bloom.
- `src/frontend/src/themes/materials.css:5`: `.bbx-card-theme {` resets card
  material tokens. Supply Ribbon tokens so nested explicit cards stay independent.
- `test/tours/bloom-theme.tour.ts:6`: `tour({ name: "bloom-theme"` covers settings,
  card inheritance and menus; adapt the walk for Ribbon without fixture cloning.

## Prior art (external)

No external premise or dependency. Use the approved original geometric study,
not an artist's work or removed material.

## Ontology

Existing system theme and card theme share `ribbon`; its single stock is `flow`.
The catalog entry pairs Ribbon first, then Paper and Sticky note. No new fields.

## Tracks / scope

1. Register `ribbon` with chrome and card support. Extract the approved original
   SVG paths, directional gradients and subtle brush filter into an asset. One
   presentation layer paints broad bands over warm cream, with transparent
   nested desks and a separate miniature swatch. Dark green toolbar, gold rule,
   asymmetric shaded controls; plain warm tabs, cream active tab.
2. Cream card, dark green ink, rust links, gold quote washes, a simple green
   edge and soft shadow. Serif card heading only, with ordinary body text.
   Green user slip; translucent cream replies and callouts; cream composer and
   green enabled sends. Preserve disabled, recording, error, hover and focus
   states. Metadata on cream backing; no clipping of sticky speech controls.
3. Docs, catalog resolver and API expected-list checks, focused tour and real
   synthetic chat captures at desktop and phone widths. Restore the prior test
   theme after the automated tour; leave a reviewed Ribbon preview for the human.

## Could this be simpler?

A studio-only variant cannot satisfy “full theme”: it is unavailable in Settings
and does not exercise real chat controls. The existing catalog plus scoped CSS
is the smallest production implementation. No generic theme abstraction needed.

## Subplans

None; one appearance with an approved reference and existing data contract.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Theme absent from picker or lost on reload | Resolver + focused tour | Catalog-backed settings | Visible |
| Background repeats or is hidden in transcript | Desktop/phone real chat | Single decorative layer, shared desk class | Visible |
| Dark band reduces text contrast | Compute worst-case composited pairs and inspect | Cream panels and metadata backing | Visible |
| Disabled send or recording cue recolored | Studio and real composer inspection | Enabled-only send, idle-only mic selectors | Visible |
| Explicit card inherits wrong ink | Resolver test + Paper card view | Reset material tokens | Visible |
| Decoration captures clicks | Properties/menu browser checks | Pointer-events none | Visible |
| Printed art consumes ink | Print styles inspection | Remove decoration/shadows, retain quote distinction | Visible |

## Agent-flow / user-flow edge cases

- ADDRESSED: wrong field/stock and fabricated values use existing validation;
  no new parser or free-form agent input.
- ADDRESSED: stale refs and concurrent editing use existing settings mutations;
  no new file writes or persistence mechanism.
- ADDRESSED: explicit card choices and landmark override precedence use existing
  resolvers, covered by theme doctests.
- ADDRESSED: no migration or partially rewritten data; additive catalog choice.
- ADDRESSED: switching themes removes attribute-scoped Ribbon appearance.

## NOT in scope

- Signal or another Ribbon variant: Signal was rejected; one Ribbon was approved.
- Theme engine redesign, box-authored themes or new selection interactions.
- Merge or deployment; those wait for a human finish request.

## Finish scope update

The human approved the previously excluded ThemedFileCard layout repair during
finish. The entry, helpers and matching doctests now live under the required
`view/` unit; the mechanical move does not alter theme behavior. The issue is
closed after commit `c69cd3b04` resolved the layout finding.

## Open design questions

None. The approved study sets direction; contrast checks may require a slightly
more opaque reply panel while retaining visible color flow.

## Knowledge audits

No new agent concept; another value of the existing theme choice. Update the
current theme reference without adding a guidance workflow.

## What will hold this after it ships

Resolver/API doctests cover catalog and pairing behavior. A focused tour covers
settings/reload, inherited/explicit material and Add menu at both widths. Real
chat inspection covers user/reply/callout and enabled/disabled mobile composer.
Existing checkbox labels and floating-menu landmark findings stay recorded.

## Implementation order

Plan review, catalog/styles/SVG, docs/tests/tour, real browser verification,
cross-model diff review, adjudication, commit with repository gates.

## Rollout shape

Done when Ribbon is selectable and persistent, unthemed cards inherit it,
explicit cards keep their material, desktop/phone captures match the approved
study, and selected tests/typecheck/lint and review are complete. No migration.

## Plan review

Accepted the three review findings: add explicit chrome/card/code selection pairs
and invert selection on the green user slip; keep approved reply translucency but
use darker rust `#84300b` links and `#514a34` muted text over the bands; break the
card's green top edge across the active companion-tab joint and clear the tabstrip
overflow fades. Tabs belong to card material. Serif headings use a direct heading
selector so nested explicit cards retain their own font.

## Implementation review

Accepted all three diff findings. Activity and pending captions now receive
readable ink/backing without changing success/error cues. Enabled send/mic hover
and load-older loading state have explicit treatments. Tab border color applies
only to its top and sides so inactive tabs keep a transparent bottom border when
a non-card is active. Also gave the empty-chat label a cream backing.

## Verification

Full backend/frontend typecheck, changed-file lint and documentation checks pass.
The focused tour covers four checkpoints at desktop and phone widths with zero
behavioral findings. Six axe reports repeat the two known issues: Markdown task
checkbox names and the floating Add menu landmark. Real synthetic transcript
captures cover desktop/mobile replies, callouts and composer. Worst-case reply
contrast over the darkest band is 7.27:1 body, 5.43:1 links and 5.50:1 muted text.

Selected tests completed: 578 files, 7,402 checks passed. The synthetic activity
row renders with the darker ink; the idle microphone hover changes to its
lighter green. The test-box theme is left on Ribbon for human preview. Nothing
has been merged or deployed.
