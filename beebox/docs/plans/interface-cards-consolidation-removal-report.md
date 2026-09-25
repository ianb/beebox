---
title: "Interface card consolidation — removal report"
status: partial
workstream: interface-as-cards
issues: []
---
# Interface card consolidation — removal report

The [consolidation plan](interface-cards-consolidation.md) replaces separate page and
preview presentation with the existing card workspace. Rollout and manual
acceptance remain open; this report measures local implementation.
Counts are physical lines including comments and blanks, not performance claims.
A negative net removal means growth. Moved behavior counts at its destination.

## Baseline and accounting

- Planning baseline: `2fe4d4d897d3a7bb97da505989eab74c3a280878`.
- Implementation start: `e72487d1dad6c473a4cf124b1c2724cee1e79214`.
  Intervening commits only change planning documents.
- Frontend source baseline: **625 files / 75,482 lines**, tracked `.ts`, `.tsx`,
  and `.css` under `beebox/src/frontend/src/`.
- Counts use `git diff --numstat --find-renames <start> <end>` and
  `git diff --name-status --find-renames <start> <end>`; totals group frontend
  production, other production/tooling, tests, and documentation separately.
- Stage ranges are adjacent and nonoverlapping. Cumulative comparison begins at
  implementation start. Unrelated main changes are excluded by commit attribution.
  No stage is counted as complete before its required checks pass.

Main integration `8c793909d..bf96522d1` merges main `2208c738c`. Its changes
(including moved-card recovery and PDF support) are excluded from workstream
removal totals. Integration checks passed 94 focused assertions, frontend
typecheck/lint, and all commit hooks. Stage F starts at `bf96522d1`.

## Stage results

Results below describe completed implementation stages; browser and final
acceptance remain separately tracked.

| Stage | Commit range | Frontend added / deleted / net removed | Other production added / deleted / net removed | Tests added / deleted | Docs/other added / deleted |
|---|---|---|---|---|---|
| A: single-card entry | `e72487d1d..2eb9189e5` | 117 / 371 / **254** | 0 / 0 / 0 | 34 / 3 | 64 / 9 |
| B: canonical seeds/cohorts | `2eb9189e5..bdb8798d9` | 0 / 0 / 0 | 208 / 45 / **−163** | 125 / 12 | 13 / 8 |
| A follow-up: explicit chat reveal | `bdb8798d9..4ffacb515` | 92 / 19 / **−73** | 0 / 0 / 0 | 67 / 1 | 0 / 0 |
| C: Questions/Landmarks | `4ffacb515..b899d0b16` | 45 / 71 / **26** | 0 / 0 / 0 | 45 / 1 | 26 / 2 |
| D: History | `b899d0b16..2a6c82854` | 267 / 297 / **30** | 0 / 0 / 0 | 135 / 1 | 34 / 3 |
| E: Storage/Admin/utilities | `2a6c82854..8c793909d` | 333 / 166 / **−167** | 0 / 0 / 0 | 105 / 1 | 35 / 4 |
| F: alternate presentation removal | `bf96522d1..43f948450` | 172 / 670 / **498** | 14 / 7 / **−7** | 171 / 190 | 332 / 94 (includes generated 106 / 0) |

## Retired UI and surviving behavior

**A:** deleted CardViewPage, ViewPage, OpenChatControl and the orphaned useUrlView
hook. Removed the FileView page-only mode/header and its card-theme branches.
Retired the separate Back to Dashboard and page Chat/New buttons; explicit chat
actions survive inside CardActions with full target state and native-composer
mode preserved. Four files deleted; shared behavior moved is counted as additions. Keep source/media/capture dialogs, recipient history,
the draft/emission runtime, native bindings, and ambient replies. Legacy URL and
old-history read adapters are reported as retained, not hidden from the count.

**B:** added five schemas and the new migration; no files removed. The historical
migration still seeds and validates only its original three cards. New enrollment
requires all eight, preserving existing notes and protecting staged deletions.
This stage grows production code by 163 lines; it is not UI removal.

**C:** deleted QuestionsPage, LandmarksPage and the component-based ChatsPage
redirect. The list bodies and authored view-card support remain. Existing
navigation entrances now open the canonical cards; three files deleted.

**D:** deleted HistoryPage and the saved-view "Open in History" escape. Both
canonical and authored History cards use the full filter/detail body with
card-owned state. One source file deleted; new state parsing, route readiness,
and selection code are counted as additions. Legacy History URLs remain adapters.

**E:** retired CapturePage and Admin/Storage page navigation chrome. The existing
management bodies now render as cards; Storage display state and Admin arrival
state are explicit card adapters. Developer harnesses use a separate utility
layout, and box validation precedes the product runtime. One source file deleted.

**F:** removed ViewOverlay, BackToChatChip, last-chat, and route-attention.
Renamed the remaining card-context store to selection-context-store; this is a
rename with deletions, not a fifth removed file. Removed page/overlay visibility
and navigation forks, obsolete History query converters, and Settings page
chrome. A single workspace now owns card opening and attention. Source/media,
task and capture dialogs remain, as do recipient binding, drafts, native
publication, and ambient replies. Legacy URL/history reads remain adapters.

## Cumulative removal

Across A–F, frontend production changed by **1,026 additions / 1,594 deletions**:
**568 net lines removed**. Other production and tooling grew by **170 lines**
(222 additions / 52 deletions), primarily migration safety and card seeding.
The combined production reduction is therefore **398 lines**. These totals
include replacement code, not just the deleted wrappers.

**13 production files were deleted**, plus one obsolete test file. One source
store was renamed and reduced. Tests, documentation, and generated guidance are
reported separately and are not included in production removal. Stage G is the
report/acceptance record, not an additional production reduction.

| Category, A–F | Added | Deleted | Net removed |
|---|---:|---:|---:|
| Frontend production | 1,026 | 1,594 | **568** |
| Other production/tooling | 222 | 52 | −170 |
| All production | 1,248 | 1,646 | **398** |
| Tests | 682 | 209 | −473 |
| Authored documentation/other | 398 | 120 | −278 |
| Generated audit ledger | 106 | 0 | −106 |

The gross totals sum adjacent stage ranges, excluding the main integration.
A direct baseline-to-final diff can have smaller gross totals because edits to
the same lines cancel; its net, minus the excluded integration net, must agree.
The net cross-check is 517 − (−51) = **568** frontend lines and
−516 − (−346) = **−170** other-production lines.
The `context-history.yaml` audit ledger is generated evidence (+106 / −0 in F),
not authored guidance and not source reduction. No bundle, speed, or memory-use
improvement is inferred from these counts.

## Verification and limits

**A:** affected doctests passed (3 files, 27 assertions), exact changed-file ESLint
and all commit typecheck/doc gates passed. A live legacy card link entered the
workspace; its projected URL retained nativeComposer. Review found that explicit
chat actions lacked an intent to reveal chat from a focused workspace. The
follow-up uses existing pane actions after the recipient binds. Desktop before image and
DOM snapshots are retained for the final exhibit. Later-stage evidence, knowledge audits, and implementation review are recorded below. No bundle-size, speed, device, or production claim follows from
a line-count reduction.

**B:** focused migration/cohort checks passed 64 assertions; related schema,
initialization and package checks passed 263. The broader affected run completed
418 files with 5,524/5,525 assertions passing. Its sole failure was a fixture's
tracked-file count (54 → 59 after the new seeds); the corrected fixture passed all
3 assertions on rerun. All commit typecheck/lint/doc gates passed. No deployed
box was migrated by this stage.

**A follow-up:** all 419 affected test files passed, plus 57 focused navigation
assertions and frontend typecheck/lint. Browser verification confirmed a new
recipient, retained Dashboard target/native mode, desktop split layout, and
mobile transcript with Dashboard as its return target. The one-shot intent was
cleared. An empty native transcript has no composer controls; their absence is
not evidence that chat is hidden. Browser animation frames stopped advancing in
this session, so the walkthrough used reduced-motion mode and reloaded after
viewport changes; animation behavior is not verified by it.

**C:** all 420 affected test files passed (5,571 assertions), alongside focused
renderer/navigation checks and frontend typecheck/lint. Browser navigation from
Questions to Landmarks and back retained the exact recipient, unsent composer
draft, and unsent question note. No answer or chat message was submitted.

**D:** all 421 affected test files passed (5,582 assertions), with frontend
typecheck, focused lint, and state/renderer regressions passing. Three small UI
follow-ups added scoped retry IDs, summary wrapping, and mobile error visibility;
their typecheck/lint passed, and browser checks verified the resulting behavior.
A deliberately held authored-card
lookup left the recipient, workspace snapshot, and unsent draft unchanged. Once
released, the normalized History target combined the saved workflow default
with the session filter, without selecting that filter as a chat recipient.
Reset restored the saved defaults; Back restored the prior filter. Commit A → B
→ Back A reused the same mounted detail element. Canonical and authored History
cards displayed together with no duplicate DOM IDs; changing one card's filter
left the other's selected commit and state intact. At mobile width, a missing
commit showed its error; an injected request failure showed a reachable Retry,
which recovered after the injection was removed. Screenshots are retained for
the final exhibit; these are browser checks, not native-device acceptance.

**E browser checks:** Storage retained direct/bytes/unlinked choices across reload,
with the same recipient and unsent draft. Admin error arrivals through both the
legacy URL and canonical target displayed their notice, scrolled once, and removed
temporary arrival state. The callback adapter dropped the synthetic authorization
code. No OAuth grant was performed. Capture opened on fresh entry and reopened
from a retained conversation after dismissal; native-composer entry suppressed
the web capture UI. Composer and speech developer harnesses rendered outside the
product navigation. An unknown-box request reached the existing authentication
wall, so the actual unknown-box error UI remains unverified in this browser.
These checks made no recording, sent no message, and changed no credentials.

**E automated gates:** all 422 affected test files passed (5,604 assertions),
with frontend/root typechecks, exact changed-source lint, and focused card-state
regressions passing. The root Knip scan still reports its recorded baseline
findings; no new E helper/file finding was introduced.

## Acceptance boundaries

The checks above are local worktree evidence. They do not establish deployment
or per-box migration convergence.

- Canonical presence, migration cohort postconditions, partial seeding, notes
  preservation, and staged-deletion protection have automated coverage. The live
  worktree fixture was seeded for browser checks; its dirty/pending migration
  state was not marked complete.
- The existing Admin authorization procedures remain in place. Automated auth
  tests cover denial, and browser controls exposed the existing authenticated
  owner requirement. A real non-owner login and an OAuth grant begun before
  deployment remain manual acceptance checks.
- Browser mobile widths and native-composer query mode do not prove physical
  device behavior, recording continuity, or the native attention bridge.
- Production migration enrollment and regenerated agent guidance must be checked
  at rollout. This workstream has not changed production boxes.

## Final-stage verification

The independent implementation review identified three regressions, all addressed:
failed authored-History classification now retains its unclassified filters inside
the card target without selecting the filter session as chat recipient; filter
changes and Reset drop an excluded commit; embed mode no longer receives an
implicit selection sink. Follow-up review verified these fixes and identified an
unnecessary lookup for non-History instruments/explicit renderers; those now skip
classification, with a throwing-loader regression.

Browser probes also verified the following:

- A failed metadata lookup preserved the exact conversation and unsent draft,
  retaining the History session filter in the nested target.
- A two-entry legacy overlay history stack retained Settings. Restore cards
  replaced the current entry; Browser Back reached the genuine prior entry.
  New writes omitted the old overlay field.
- A synthetic reply appeared while chat was hidden. Its card link opened
  Dashboard without changing the recipient or draft; explicit Open conversation
  revealed chat with Dashboard as its return card. A missing reveal on the
  keep-current path was corrected and replayed successfully. Fetch injection
  was removed; no message was sent.
- Browser-side native publication switched attention between Dashboard and saved
  History while retaining the recipient. This is web-payload evidence, not a
  physical-device claim.
- Admin processed one reconnect per arrival, including Back followed by a new
  arrival reusing the history index. Temporary arrival state cleared.
- Changing a filter after selecting a commit removed the old commit state,
  without a false missing-commit message.
- Selecting text in Browse's detail initially exposed two selection buttons.
  Nested capture now stops the gesture at its own boundary. The replay showed
  one button and one selection identifying the detail card; the test selection
  was removed from the unsent draft. A Browse tour regression covers this case.

All six affected Claude knowledge audits passed against the disposable
`cards-audit` fixture. Three wording-sensitive assertions were corrected and
rerun after substantive answers were inspected; these audit reference lookup,
not zero-read recall. The fixture's missing ignored metadata marker was repaired
locally, and the harness left its working tree clean with all eight anchors.
Production generated guidance is not covered by that result.

The final affected-suite run passed **426 files / 5,703 assertions**. The later
History classifier regression also passed its focused 16 assertions. Full backend, frontend, user-story and tooling typechecks passed. Changed-file
lint and all repository commit gates passed. The navigation tour recorded 11
checkpoints with zero axe violations: mobile completed; desktop timed out opening
Admin after Settings. This is not reported as an entirely green tour. Earlier
focused Admin and Capture browser checks provide the missing surface evidence.


To reproduce the source totals, use `git diff --numstat --find-renames START END`
for every range in the stage table. Frontend means `.ts`, `.tsx` and `.css`
under `beebox/src/frontend/`; other production/tooling means remaining `.ts`,
`.tsx`, `.js`, `.css` and `.sh` files. Classify `/test/` paths and `.doctest.md`
files as tests first. Remaining files are documentation/other, with generated
`beebox/src/dev/context-history.yaml` separated above. Count deleted paths with
`git diff --name-status --find-renames START END`; a rename is not a deletion.


The counted implementation ends at `43f948450`. Stage G changes only this report
and the plan acceptance record; its self-documenting edits are excluded from the
A–F documentation totals above. The commit includes one incidental broken issue
link repaired by the required doc-check pass; it changes no issue disposition.


The final theme probe verified 20px desktop and 12px mobile side gutters, the
intentional zero-gap join below tabs, authored paper/cream styling, two quote
forms, and the 44px Properties control. The theme tour's old top-gap and literal
tab-title assumptions were corrected; its full five-card sweep did not complete
under the browser contention, so no full-sweep pass is claimed.

The Browse interface tour passed its desktop assertions, including the new
nested-selection regression; its mobile navigation timed out. A fresh mobile
DOM replay at 390px then verified one detail heading, no page overflow, exactly
one selection button, and the unchanged unsent draft. The temporary selection
was cleared. Screenshot artifacts from the earlier stages and final mobile
checks are packaged in the workstream exhibit, `interface-cards-consolidated-workspace`.


The workspace tour's initial three axe findings came from the static boot screen
after a readiness timeout, not the mounted workspace. Its serial retry passed
navigation and the card heading, then stalled during screenshot capture. The
stalled test/browser was stopped. A focused replay without screenshots verified
Minimize cards → no visible cards plus transcript and Restore control; Restore →
exactly one retained card, with canonical `card=` URL and no captured page errors.
A later reload also stalled, so the full reload/link-retention tour is not claimed
as passing. Earlier route/reload probes and automated retention/navigation tests
remain the evidence for those behaviors. No application assertion failed in the
bounded workspace replay.

## Finish integration — September 11

After fetching origin, local main `bb5117e34` included origin/main `f41d7982f`
and the related chat-everywhere changes. Merge `b0c39c368` retains main's removal
of the redundant ready-state destination notice, suppression of ambient replies
for the selected conversation, and updated smoke expectations. It also retains
consolidation's route-readiness/native-publication guard and deletion of the old
show/hide presentation callbacks. Incoming resilient voice-recording changes
remain at their upstream implementations and keep the native wire shape.

This integration and finish-only documentation are excluded from the A–F counts
ending at `43f948450`. Track O found no new containment, card-write, unsafe-cast,
or silent-failure defect: History lookup failure routes to the visible card error
surface; bootstrap remains exclusive-create rather than read/modify/write; Admin
arrival fields are independent optional query values rather than lifecycle states.

The final main recheck then found the transcript-selection landing `4ce238009`.
Merge `1ca6cd895` preserves its transcript selection capture and nullable source
refs alongside the renamed selection-only context store and the existing
visible-card sink. Native selection encode/decode and contract fixtures remain
upstream's new shape; consolidation adds no further protocol change. This merge
is also excluded from source-removal totals. Finish verification reruns against
the combined tree rather than relying on the earlier green result.

A subsequent recheck found local main `4003f6e57` (OpenRouter services and secret
entry guidance), still containing fetched origin/main `f41d7982f`. Merge
`a32b83560` keeps the updated Secrets section inside the canonical Admin card,
VoiceChip capability checks and warnings inside the retained composer, and
shared-versus-isolated secret-store authorization. These upstream changes are
also excluded from removal totals. The full finish decision sheet is rerun
against this combined tree, including browser smoke.

## Browse workspace follow-up — September 12

Measured from `6342c7b58` to the commit containing this entry, the Browse follow-up
adds 82 and deletes 252 frontend production lines: **170 more net lines removed**,
with one production file deleted (`BrowseDetailPanel.tsx`). No other production
code changes. Tests, guidance, this report, and the generated knowledge-audit
ledger are excluded from that count. The historical A–F totals above remain
unchanged; adding this follow-up gives **738 net frontend lines removed**, **568
net production lines removed**, and **14 production files deleted** across the
attributed work, excluding intervening main integrations.

Browse now opens normal files through the workspace's right-side tabs on desktop,
including relocating a file already retained on the left. Directory navigation
stays in the singleton Browse card; mobile uses the existing single-card behavior.
Old Browse detail URLs hand off to ordinary cards while retaining viewer and
parameter state. The nested file renderer and its duplicate selection plumbing
are removed.

Validation: the affected test run passed 124 assertions across four suites;
the final placement corrections passed all 38 workspace assertions. Typechecks,
changed-file lint, and the focused box-agent knowledge audit passed. Browser
replays covered desktop placement, existing-left-tab relocation, mobile width,
directory Back, legacy detail targets, retained drafts, and cancellation of a
delayed directory lookup after a newer file click. Before/after and mobile images
are in the workstream exhibit `browse-opens-workspace-tabs`.

Independent review identified explicit-destination precedence and non-hinted
focus behavior regressions; both were corrected and covered by assertions.
Its internal-scroll concern was traced to the preexisting natural-height themed
card container: long Browse lists continue to scroll in the workspace tabpanel.
This follow-up does not introduce a separate renderer sizing contract.
