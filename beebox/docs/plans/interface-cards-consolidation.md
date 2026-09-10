---
title: "One workspace for interface cards — retire parallel page UI"
status: active
workstream: interface-as-cards
issues:
  - ../../../issues/code-quality/2026-08-02-card-vs-views-route-consolidation.md
---
# One workspace for interface cards — retire parallel page UI

Open a card, inspect History, or change an Admin setting without leaving the
workspace or resetting the conversation. Replace the remaining parallel page
implementations with card targets, then remove their separate chat and preview
presentation machinery. Report the actual deletions at each stage and overall.

**Issues addressed:** [Parallel card routes](../../../issues/code-quality/2026-08-02-card-vs-views-route-consolidation.md)
is the closure target. [Chat everywhere](../../../issues/features/2026-08-30-chat-input-everywhere.md)
and [mobile presentation](../../../issues/features/2026-07-23-mobile-modal-not-split-pane.md)
are related, not automatic closures. Both existing plans claim parts of mobile
presentation; this plan owns removal of the alternate page/conversation overlay,
not their remaining device acceptance. Searches for questions/history/landmarks,
admin/inventory cards, and card-route duplication found those overlaps but no
separate issue requiring canonical Admin or Storage cards.

This follows [canonical interface cards](interface-as-cards.md). It supersedes
that plan's restriction to three surfaces only when this draft is approved.
It preserves the pane mechanisms in [workspace controls](workspace-pane-controls.md)
and the conversation lifecycle in [chat everywhere](chat-everywhere.md).
Implementation stages are commit boundaries. The complete plan ships together,
only on the boxholder's instruction.

[Engineering review and dispositions](interface-cards-consolidation.review.md)
record the independent review and the resulting corrections.

## Stated preferences this plan trades against

- September 10 direct request: “bbx-plan the entire set as a multi-stage
  process” and “a report of how much was removed in the process.” This is the
  planning phase; the report distinguishes measured removal from estimates.
- September 10 Admin decision: “I think it should be a card, yes. I'd rather
  work through it than around it.” Admin uses `_config/interface/admin.card`
  in the existing workspace, preserving the live conversation. Keep backend
  permissions and visibly distinguish box-specific from host-wide operations.
- Prior direct choices: type infers rendering; designated instruments have a
  single canonical location; Browse is one card with directory state; use the
  existing open-card primitive without changing panes. These constrain all new
  instruments, not existing plural authored view cards.
- [Engineering principles](../engineering-principles.md) §8, “One way to do
  each thing”: remove competing page implementations, not their useful bodies.
  §7 requires predictable addresses. §3 requires parsed state and migration
  boundaries. §4 requires visible repair/errors. §9 preserves essential
  recipient/attention state. §10 and §11 require regression checks rather than
  a prose-only ban on reintroducing page renderers.
- Preserve explicit recipient changes. Passive opening and browsing only change
  attention. Retain draft/emission identity, native binding, ambient replies,
  and the existing mobile workspace controls (shipped precedent above).

## What already exists

Evidence checked on September 10 at baseline
`2fe4d4d897d3a7bb97da505989eab74c3a280878`. Paths below are relative to
`beebox/`; quotes identify the existing mechanism, not future code.

| Source and verbatim evidence | Reuse / removal direction |
|---|---|
| `src/frontend/src/components/chat/workspace/WorkspaceProvider.tsx:37`: `const participating = location.pathname.endsWith("/chat") \|\| location.pathname.includes("/views/");` | `/card`, History, Admin, and Storage still take the other layout; move their targets into this workspace. |
| `src/frontend/src/router.tsx:105`: `path: "/dashboard",` and `:107`: `throw redirect` | Keep the existing thin legacy-URL adapter pattern, not a second page renderer. |
| `src/frontend/src/pages/card/CardViewPage.tsx:4`: `off to FileView inside a Card shell.`; `:80`: `Back to Dashboard` | Remove the redundant full-page wrapper and back action. |
| `src/frontend/src/pages/card/components/OpenChatControl.tsx:34`: `utils.chat.openForCard.fetch({ cardPath })` | Preserve explicit recent/new conversation resolution in the card action menu before deleting these page buttons. |
| `src/frontend/src/pages/ViewPage.tsx:61`: `mode="page"` | Verify route consumption by workspace, then remove the redundant FileView instance; the route remains an address adapter. |
| `src/frontend/src/pages/QuestionsPage.tsx:16`: `<QuestionsList />` and `src/frontend/src/pages/landmarks/LandmarksPage.tsx:16`: `<LandmarksList />` | Reuse these bodies; remove their page chrome. |
| `src/frontend/src/renderers/view.tsx:31`: `landmarks: LandmarksList,`; `:33`: `questions: QuestionsList,`; `:34`: `history: HistoryViewCard,` | Existing authored view cards remain valid and plural. |
| `src/frontend/src/components/history/HistoryViewCard.tsx:62`: `void navigate({` and `:92`: `Open in History` | History needs a card-owned state adapter and full feature parity, not just a route redirect. |
| `src/frontend/src/pages/HistoryPage.tsx:54`: `<HistoryBrowser` | Reuse the same browser body with filters and commit selection. |
| `src/frontend/src/pages/inventory/InventoryPage.tsx:17`: `export function InventoryPage()`; `:19`: `useState<Projection>("grouped")` | Reuse inventory queries/body; lift its three display choices into card view state. |
| `src/frontend/src/pages/AdminPage.tsx:31`: `id="bbx-admin-back"` | Drop page navigation chrome; keep management controls and existing backend authorization. |
| `src/frontend/src/components/chat/everywhere/BoxConversationShell.tsx:104`: `routeContent={workspace.participating ? undefined : children}` | Delete alternate presentation only after its callers are gone. |
| `src/frontend/src/components/chat/everywhere/use-conversation-route.ts:30`: `location.state.bbxConversationOverlay === true` | Retire overlay presentation state after a bounded history compatibility adapter exists. |
| `src/frontend/src/hooks/useViewNavigate.ts:35`: `overlay.open(target, hint);` | Route ordinary card inspection through workspace.open, then delete this preview implementation. |
| `src/core/system-cards.ts:72`: `requireComplete \|\| enrolled`; `:73`: `new Set<string>(Object.values(SYSTEM_CARD_PATHS))` | Current enrollment requires the entire table. Do not append new cards and retroactively require them under the old migration. |
| `src/core/system-cards.ts:103`: `flag: "wx"` | Preserve missing-only creation and user notes. |

Schema filename search found no existing `questions`, `landmarks`, `history`,
`inventory`, or `admin` schema files. Recheck before implementation if main moves.
The initial code-health scan ran from the wrong package: `lint:knip` and `knip.ts`
live at the monorepo root (`package.json:20`: `"lint:knip": "knip"`). Run the
configured root scan for final cleanup. Direct import/caller and route tracing
supplies the removal inventory; raw unconfigured Knip output is not evidence.

## Prior art (external)

- [React state preservation](https://react.dev/learn/preserving-and-resetting-state):
  component position controls state retention. Preserve the single runtime and
  retained card roots during route changes; moving state owners can reset drafts.
- [TanStack search navigation](https://tanstack.com/router/latest/docs/how-to/navigate-with-search-params):
  search can be replaced or updated. Renderer callbacks must update the card
  target without overwriting unrelated conversation/workspace search state.
- [TanStack search parameters](https://tanstack.com/router/latest/docs/guide/search-params):
  URLs support copied links and history. Keep legacy link inputs as thin adapters
  and test direct entry as well as clicks. These docs were searched September 10;
  none supplies this application's canonical-card or recipient policy.

## Tracks / scope

### A. Record baseline and consolidate single-card entry

**What / why:** `/card` and `/views` currently supply two experiences for the same
file. Keep `/views/<path>` as the canonical card link to minimize shipped caller churn
(§8 and existing workspace precedent); this does not introduce a `view:` field.

**Direction:** Convert `/card/$` to a replace redirect preserving path, renderer,
renderer params, viewState, shell params, and inherited history state. Parse and
separate these with the existing view URL/system-card helpers. Update first-party
links to open cards. Keep the redirect for old bookmarks and external clients.
Remove CardViewPage and its page-only back/close actions. Move recent/new “chat
about this card” into the existing file action menu (`src/frontend/src/components/card-actions/CardActions.tsx:14`: `export function CardActions`), reusing chat.openForCard;
only explicit invocation selects a recipient. It should reveal chat through
existing workspace actions and retain the selected card target, including state.
Remove OpenChatControl after its only caller disappears. Make the `/views` route
a target adapter with error/loading behavior supplied by the workspace; remove
ViewPage's duplicate FileView only after direct entry and recovery are tested.

**Vocabulary lock-ins:** `/views/<path>` stays the canonical shareable card link.
The existing workspace projects it into `/chat?card=<serialized-target>`
(`src/frontend/src/components/chat/workspace/WorkspaceProvider.tsx:56`: `to: href`,
and `src/frontend/src/lib/system-card-navigation.ts:68`: `search.card = serializeViewUrl(input.target)`).
A copied address-bar URL uses that workspace form. Preserve both entry forms,
including the one-shot `companion` parameter; `view` query remains an optional
renderer override. No route rename or new pane action.

**First implementation chunk:** snapshot the report baseline; add redirect and
explicit-chat regressions; migrate `/card` and its controls. All decisions above
are settled for this chunk.

### B. Seed the remaining canonical instruments

**What / why:** Every production box surface needs an ordinary target before the
alternate layout can be removed (§7, §8). Proposed type/location table:

| Type | Canonical path | Label / body |
|---|---|---|
| questions | `_config/interface/questions.card` | Questions / QuestionsList |
| landmarks | `_config/interface/landmarks.card` | Landmarks / LandmarksList |
| history | `_config/interface/history.card` | History / HistoryBrowser |
| inventory | `_config/interface/inventory.card` | Storage / InventoryContent |
| admin | `_config/interface/admin.card` | Admin / existing management sections |

Each is a type-inferred, single-location instrument with title and notes like the
existing three. No new generic `system` type or mandatory `view` property.
Existing `*.view.card` instances remain plural, including saved History filters;
there is one canonical History entrance, not a ban on authored filtered views.
The earlier background design kept Admin as a shell permission boundary
(`docs/design/interface-as-cards-background.md:299`: `Permission boundary`).
The boxholder superseded that presentation decision on September 10 by choosing
an Admin card. Preserve the permission model, single open-card operation, and
live conversation. Admin
includes host-wide operations: its renderer must label that scope as the existing
controls do; a per-box anchor does not make those operations box-local.
The card is an address, not authorization. Admin's API checks (`src/webapp/trpc/routers/admin.ts:194`: `boxConfig: ownerProcedure.query`) and secret storage
stay authoritative; no secrets move into card frontmatter or notes.

**Direction:** Extend the finite shared table and renderer-location checks. Add
an append-only `remaining-interface-cards` migration. Split required presence by
migration cohort: `canonical-interface-cards` still requires exactly the original
three; the new marker requires all eight. Index OR HEAD enrollment protects each
cohort; HEAD-present cards remain protected even without a marker. Fresh init
seeds all eight before recording migrations. A migration must validate its own
postcondition before recording success, including sweep and mark-applied paths.
Do not reuse an old all-current-cards assertion for the historical migration.
Seed, assert, dry-run descriptions, and repair errors must all take the cohort,
not only the presence validator. The original script still calls seedSystemCards
(`scripts/migrate/canonical-interface-cards.ts:9`); update it to pass the original
three explicitly. `src/core/migration-run.ts:114` and `:122` gate manifest writes
with `assertSystemCardsComplete`; make those gates name-aware for both markers.
The original script after table growth must write only the original three, and
its retry/mark-applied must not require the new five. New migration completion
requires all eight. Missing-only writes preserve notes; conflicting paths/types fail visibly. Dirty
boxes stay explicitly pending; they must not be described as converged.

**Vocabulary lock-ins:** the five names above and the new migration marker.

**First implementation chunk:** cohort validation tests and seed/migration tests,
then schema/registry additions. Reuse the existing bootstrap mechanism rather than
introducing a second migration framework.

### C. Move Questions and Landmarks; preserve navigation entrances

**What / why:** Their shared list bodies already support cards, while page wrappers
keep the alternate layout alive (§8).

**Direction:** Register canonical renderers with location guards; menu entries
open their targets; legacy `/questions`, `/landmarks`, and `/chats` redirect.
Retire QuestionsPage, LandmarksPage, and the ChatsPage redirect component in favor
of route adapters. Keep the actual question-answering, landmark, session-picker,
and navigation controls. Opening the list does not change recipient; selecting a
landmark conversation still does. New cold instrument entry uses box-root context;
existing selected conversation wins on later navigation.

**Vocabulary lock-ins:** existing list and conversation semantics.

**First implementation chunk:** Questions renderer/redirect and retained-state
walkthrough; then Landmarks and Chats aliases with explicit-recipient checks.

### D. Make History a complete card experience

**What / why:** A card with an escape to a fuller page preserves two implementations
and can mutate the outer chat URL (§8, §3).

**Direction:** Use one History body for canonical and authored saved-filter cards.
Expose the full filter bar and commit detail within the card. Keep authored
frontmatter as defaults, explicit link/query filters as input overrides, and
interactive filter/commit changes as validated card viewState. State contains
`filter` (the existing HistoryFilterState shape) and optional `commit` hash.
An absent commit selects the newest item; explicit `null` returns to the timeline
without immediately selecting it again, including after reload or Back. A
missing state filter falls through to supplied defaults; an explicitly empty
filter means no filtering. Reset clears overrides back to that card's defaults.
Pass renderer-owned onViewStateChange to the body; never call the outer router
from the History body. Filter changes push; commit selection replaces, preserving
the existing page behavior. Preserve every supported page filter, including path and
session. The existing saved-view codec is narrower: `src/shared/named-views.ts:90`
starts `export const HISTORY_VIEW_PARAMS`, while
`src/frontend/src/components/history/history-filter.ts:60` sets `path: null`
when deriving a saved filter. Use a dedicated full History viewState/legacy-page
parser for the path filter; do not pass page inputs through that narrower codec
and drop them. This does not require changing authored frontmatter. Resolve abbreviated commit hashes by reusing HistoryBrowser's paged list search
(`src/frontend/src/components/history/HistoryBrowser.tsx:93`: `c.hash.startsWith(initialHash)`),
including its missing-commit state; there is no special hash-resolution endpoint.
Adapt `/history` and `/history/$hash` to canonical History target/state, carrying
all existing filters. Invalid filters or missing commits give a localized error.
History has a reserved-key collision to resolve explicitly:
`src/frontend/src/lib/system-card-navigation.ts:45` includes `"session"` as shell
state, while `src/shared/named-views.ts:130-131` treats it as a History filter.
For `/history` and legacy History-card link/query inputs, parse `session` and
`path` into `viewState.filter` BEFORE generic shell stripping/projection; never
forward that filter session as the recipient. Resolve the target's History
renderer identity before classifying legacy view-card query inputs. Do not infer
History just from a `.view.card` suffix. Only genuine shell options such as
nativeComposer pass from these History inputs. An outer `/chat?session=...`
continues to select a recipient; a session inside its serialized History `card`
target is a filter. Inherited recipient comes from conversation/history state.
Tests cover both meanings simultaneously, a cold legacy History link, and an
authored history view-card link, with unrelated renderers unchanged. Mounted
conversation and workspace effects must wait for that route's identity lookup
and redirect to settle before consuming its search. The browser regression holds
the actual card lookup pending and checks that neither recipient selection nor
workspace projection consumes the unclassified input.

Remove HistoryPage and “Open in History.” Existing view: history cards forward
state/callbacks through ViewCard instead of a separate URL-only adapter. Embed
mode still supports local inspection when no push-capable owner is provided.

**Vocabulary lock-ins:** existing History filter codec and card viewState, no new
saved-filter schema or migration of authored view cards.

**First implementation chunk:** History state codec and legacy filter/hash tests;
then change the shared body and both renderer adapters together.

### E. Move Storage and Admin; account for utility routes

**What / why:** Leaving either as an ordinary page retains the entire alternate
page/chat presentation (§8).

**Direction:** Storage becomes the inventory card with validated `projection`,
`metric`, and `linkStatus` state, using current defaults; changes replace card
state. Its refresh/loading/error behavior stays in the body. Admin becomes its
canonical card, retaining all management operations, errors, and permissions;
remove its Back-to-Dashboard action. Preserve OAuth return/reconnect inputs:
`src/webapp/routes/admin.ts:75` builds `returnUrl`, then returns `google`/`message`;
`src/frontend/src/components/admin/useGoogleServices.ts:74` reads `params.get("google")`,
and `GoogleServicesSection.tsx:38` reads `reconnect` from window.location.
The `/admin` adapter converts `google=connected|error`, `message`, and
`reconnect=google` into validated one-shot Admin target state. The renderer passes
these inputs to the existing controls; remove their reads of the outer URL.
After the mounted controls display/consume the input, replace-clear only those
state keys so tab switches do not replay it. Keep the backend `admin` returnPath
for grants already in flight. OAuth authorization codes remain consumed by the
backend callback (`webapp/routes/admin.ts:29,96`); the unused frontend `code`
search declaration is not persisted into a card. Neither acquires new
configuration fields.
Open their canonical targets from current menu locations and redirect old URLs.

Capture remains an action into the existing composer, not a new persisted card:
`/capture` redirects to chat with the existing capture intent. Auth/login/setup,
box selection, unknown-box errors, and developer harnesses are utility surfaces,
not alternate production page/chat presentations. Give developer routes their
explicit harness layout; keep any harness-required conversation runtime mounted
as part of its test fixture. Do not force tools into canonical cards or preserve
the production overlay merely to accommodate a harness. The current route inventory
(`src/frontend/src/router.tsx:59-279`, the `path:` declarations) is:

| Route | End state |
|---|---|
| `/`, `/auth/login`, `/auth/setup` | Existing root/identity utility layouts |
| `/<box>/`, `/<box>/$` fallback | Existing redirects into chat/root |
| `/<box>/chat`, `/<box>/views/$` | Workspace adapters; chat accepts outer recipient `session`, serialized `card`, and one-shot `companion`; views projects to chat/card |
| `/<box>/card/$` | Card target compatibility redirect (A) |
| `/<box>/dashboard`, `/settings`, `/browse/$` | Existing canonical redirects |
| `/<box>/questions`, `/landmarks`, `/chats` | Canonical redirects (C); Chats targets Landmarks |
| `/<box>/history`, `/history/$hash` | Canonical History plus parsed state (D) |
| `/<box>/inventory`, `/admin` | Canonical redirects (E) |
| `/<box>/capture` | Composer-action redirect (E) |
| `/<box>/dev/speech`, `/dev/composer-states`, `/dev/capture-mode`, `/dev/chat-scroll` | Explicit developer fixture layout outside the product conversation shell |

Unknown box is an error state, not a card. Verify this inventory against main
before F; any new route requires an explicit disposition.

**Vocabulary lock-ins:** Admin and Storage are card labels; capture remains an
action. Preserve auth and native wire formats.

**First implementation chunk:** inventory body/state adapter and redirect; next
Admin body/redirect; finally capture and harness route disposition checks.

### F. Delete alternate presentation and reconcile guidance

**What / why:** Once all production box content is a workspace target, the second
layout adds state and controls without a remaining user job (§8, §9).

**Direction:** Remove `routeContent` and the production `participating` fork;
remove conversation overlay show/hide presentation and its extra buttons/Escape
handler. Keep URL-based recipient selection/history restoration in
useConversationRoute; do not delete that entire hook because its presentation
portion vanished. Replace global ViewOverlay card previews with workspace.open,
then delete ViewOverlay and its visibility context. Keep source editing, image
lightboxes, capture dialogs, and other task-specific modals. Audit callers before
each deletion; no placeholder wrapper or new generic page container may replace
what was removed.

Retain BoxConversationShell's single runtime, selected recipient, emission/draft
store, session assignment, native publication, workspace attention, and ambient
observation/callouts. Remove route-focused card ownership once no production
caller remains, preserving selection sinks and Browse's nested-detail handling.
Remove unreachable Browse/Dashboard pathname checks and AppNav's Admin pathname
check (`src/frontend/src/components/AppNav.tsx:51`); its current-card label/state
comes from the active target after Admin conversion. Keep accepted attention wire
enum values for older native clients; this is not a protocol migration.

Old browser history may contain `bbxConversationOverlay`. At the route boundary,
translate that legacy presentation hint once into the existing workspace showChat
state while preserving `bbxConversation` and each history entry's Back semantics;
new writes omit the old field. Keep only this read adapter until the supported
browser-session horizon is explicitly settled, not the old overlay renderer.

Update the two live plans' ownership/dispositions, box interface-card guidance,
frontend guidance, tours and smoke adapters, and knowledge audits. The old plan's
manual acceptance remains honestly open unless its original checks are performed.

**Vocabulary lock-ins:** workspace is the one production presentation owner;
conversation recipient and attention remain separate concepts.

**First implementation chunk:** complete route/caller inventory and read-compatibility
regressions, then remove each alternate branch with its obsolete tests and styles.

### G. Publish the removal report

**What / why:** The boxholder asked how much was removed. Code moved or replaced
with comparable machinery must not be reported as eliminated complexity.

**Direction:** Maintain the [removal report](interface-cards-consolidation-removal-report.md)
alongside this plan during implementation. Record stage start/end commit hashes, exact
path scope, commands, and results. Preserve this planning baseline:

- Baseline commit: `2fe4d4d897d3a7bb97da505989eab74c3a280878`.
- Tracked `beebox/src/frontend/src/**/*.{ts,tsx,css}`: 625 files, 75,482 physical
  lines (including comments and blank lines), measured from git ls-files and
  splitlines on September 10. These are baseline sizes, not promised savings.
- Candidate files are not all deletable in full: CardViewPage 103 lines,
  OpenChatControl 77, ViewPage 72, QuestionsPage 20, LandmarksPage 20,
  HistoryPage 62, ViewOverlay 173, use-conversation-route 86. The last retains
  recipient logic; moved explicit-chat behavior counts as added code elsewhere.

For each stage and the total report: production lines added/deleted/net; tests
added/deleted/net; docs and generated files separately; source files genuinely
deleted versus renamed; visible controls/page wrappers retired; presentation
branches/state fields retired versus retained adapters. Also include new schema,
migration, and backend code so frontend savings do not hide displaced cost.
Use `git diff --numstat --find-renames` plus name-status and a reviewed inventory.
Net reduction is deleted minus added; a negative value is reported as net growth.
Do not sum overlapping cumulative diffs. Record unrelated main merges separately
and exclude them using the workstream commit set; use final tree comparison as a
cross-check, not an attribution shortcut. No LOC target, inflated deletion count,
or claimed bundle/performance improvement without a separate measurement.

**Vocabulary lock-ins:** gross deletion, added lines, net reduction, moved code.

**First implementation chunk:** report header/baseline and reproducible scoped
counts at A; append measured rows at each stage; finish with totals and remaining
exceptions after F. This report is a delivery requirement, not an optional summary.

## Could this be simpler?

Only redirecting `/card` would be much smaller and is stage A. It would leave
History's page escape and Admin/Storage as consumers of the second conversation
layout. Merely hiding their controls would retain the competing state owners.
The fuller plan buys removal of that entire presentation path (§8), while reusing
the current pane reducer and the real runtime (§9). Five finite anchors and two
migration cohorts are simpler than a configurable system-card registry. Keep
thin legacy URL adapters because breaking bookmarks provides no UI simplification.

## Subplans

None. The migration is a deterministic missing-only seed with cohort postconditions,
not an agent-applied transformation or a rollout expected to stop halfway. The
stages above form one dependency chain and one landing unit.

## Failure modes

“Planned” means handling is required by this design, not already verified.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `/card` redirect drops renderer, state, native flags, or recipient | Existing URL codec tests; add route preservation cases in A | Planned explicit partition/forwarding | Silent until regression added; stage A gate |
| Chat-about action disappears or passive navigation changes recipient | Existing conversation tests; add A action case | Reuse openForCard only on explicit invocation | Silent risk; action and browser gate |
| Previously migrated box suddenly requires five absent cards | Existing system validation tests; add cohort matrix in B | Planned separate markers/postconditions | Clear error but blocks upgrades if omitted |
| Partial seed overwrites notes or records completion with missing cards | Existing seed/index tests; extend B | Exclusive writes and final postconditions | Visible failure required; migration gate |
| History controls edit outer chat query and lose workspace state | Add D regression for retained pane and unrelated shell state | Planned renderer callbacks | Silent risk; no stage D completion without test |
| History session filter selects a recipient or is stripped | Add D legacy/page/authored-card/nested-target cases | Parse History input before shell options; outer chat session stays recipient | Silent risk; D gate |
| Admin OAuth notice or reconnect scroll disappears | Add E callback/reconnect/in-flight-grant cases | One-shot target state passed to controls | Silent risk; E gate |
| Old migration seeds all eight under its old marker | Add B old-script-after-table-growth case | Cohort parameter on seed/assert/manifest gates and errors | Wrong migration semantics; B gate |
| Saved History reset erases authored defaults or explicit empty filter | Extend named-view/History tests | Planned precedence and empty-filter distinction | Silent risk; D gate |
| Hidden card steals attention or selection; move resets form/draft | Existing workspace/selection tests; replay scenarios | Retain roots, visibility and single runtime | Silent risk; browser gate |
| Admin card bypasses permissions or serializes secrets into a card | Existing backend checks; add renderer/non-owner acceptance | Existing API authorization must remain; cards contain no secret values | Clear denial required |
| Old overlay history returns to wrong recipient or traps Back | Add F old-state route regression | Planned read-only legacy hint adapter | Silent risk; F gate |
| Utility route accidentally mounts duplicate composer | Add route classification and harness smoke checks | Explicit harness layout in E | Visible or state corruption; E/F gate |
| Removal count includes moves, docs growth, or other workstreams | G commit/path accounting and final tree cross-check | Planned report categories | Misleading report; delivery gate |

There are no accepted silent gaps: each missing regression/handling pair above
is assigned to a stage and blocks its completion.

## Agent-flow / user-flow edge cases

- **ADDRESSED — wrong type/location:** B applies exact canonical path validation;
  plural authored view cards keep their old schema. Errors name the repair path.
- **ADDRESSED — stale ref:** A/C/D/E retain URL aliases; missing ordinary files or
  commits keep localized error behavior. Missing required cards name the migration.
- **ADDRESSED — two agents:** B uses missing-only seed; F keeps shared session and
  selection ownership. No new concurrent card-writing mechanism is introduced.
- **ADDRESSED — hand edits:** B validates type/location and preserves notes; D/E
  parse state rather than silently coercing malformed free-form input.
- **ADDRESSED — fabricated state:** state types and existing filter codecs reject
  unsupported values. Agent guidance lists canonical paths, not guessed page URLs.
- **ADDRESSED — validation UX:** B identifies failed cohort, required path, and
  repair command; a renderer error does not mount an unauthorized second instrument.
- **ADDRESSED — partial rollout:** old marker requires old cohort; new marker only
  follows successful seeding. Dirty boxes are pending, never silently complete.

Replay these same scenarios before and after implementation; baseline artifacts
capture actual current behavior, including known differences the plan changes:

| ID | Desktop / mobile walkthrough and expected result |
|---|---|
| IC-1 | Cold `/card` link with viewer/state/native flags opens one workspace card; copy projected `/chat?card=...` URL and reload preserve it; repeat explicit `companion` entry; Back leaves the entry without a redirect loop. |
| IC-2 | With a draft and selected recipient, open Dashboard, Questions, Landmarks, Storage, Admin. Recipient/draft stay fixed; explicit recent/new chat-about selects deliberately and keeps the card. |
| IC-3 | Change History filter, select commit, open linked file, return, reset, then Back/Forward. Canonical and authored saved-filter cards preserve their respective defaults and state. |
| IC-4 | Keep History and another card visible; update an inactive card and move/focus panes. No wrong target, duplicate ID, draft reset, or hidden-card attention. |
| IC-5 | On mobile inspect a card, show chat, return to cards, and use Back. Repeat with native composer, recording, and an old overlay history entry; no extra page-level Open conversation button. |
| IC-6 | Fresh box, old-three-only box, partly seeded box, and dirty box. Retry migration, validate staged deletion, preserve notes, and report pending boxes accurately. |
| IC-7 | As non-owner, open Admin by old URL and direct card link. Existing permission denials remain; no secrets enter card source/agent notes. As owner, finish OAuth begun before deploy, receive success/error, and follow a reconnect link; notice/scroll works once. |
| IC-8 | Capture deep link, auth/setup, box selection, unknown box, and dev harnesses work without resurrecting production overlay/routeContent. |
| IC-9 | Hide chat and receive a background reply; ambient callout and explicit open-chat work, and native attention reflects the visible card. |

## NOT in scope

- New pane reducer, saved workspace model, landmark pinning, or preview replacement
  policy: existing open/move/focus behavior supplies the container.
- Converting every authored view to a canonical type: saved filters remain plural.
- Removing useful navigation entrances or instrument controls: remove duplicate
  page chrome and layout ownership, not Questions or Admin functionality.
- SDK prompt-resume repair or SDK upgrades: separate reported bug, unrelated.
- New auth model, secrets migration, or native protocol vocabulary: preserve those
  interfaces and verify overlap; change only presentation ownership.
- Eliminating all dialogs: source editing, media inspection, and capture have
  distinct interaction jobs and are not alternate ordinary-card navigation.
- Bundle-size or runtime-performance claims: deletion counts alone cannot prove them.

## Open design questions

No unresolved design question blocks implementation. The boxholder chose the
Admin card on September 10; all five new anchors have a defined destination.
Admin remains within the workspace rather than introducing a separate admin shell.
The compatibility lifetime of already-open browser history is not bounded by box
migration completion; retain the small read adapter until a later explicit client
compatibility decision. It is reported as a surviving adapter, not a failed deletion.

## Knowledge audits

Extend `src/dev/knowledge-audits.yaml` interface-card entries to cover all eight
paths, type inference, plural saved History views, missing-card migration repair,
and passive attention versus explicit conversation selection. Add a direct audit
for “open History for this file” using a card target and state rather than a page
escape. Run the affected audits on the isolated test box and record status; do not
claim per-box generated guidance convergence until deployment checks it.

## What will hold this after it ships

Use existing doctest tiers; no new framework. Extend
`test/frontend/system-card-navigation.doctest.md`,
`test/frontend/lib/view-url.doctest.md`,
`test/frontend/workspace-pane-navigation.doctest.md`,
`test/frontend/workspace-panes.doctest.md`,
`test/shared/system-card-paths.doctest.md`, and
`test/cli/commands/validate-system-cards.doctest.md` for their respective decisions.
Add focused `test/frontend/history-card-state.doctest.md` and
`test/frontend/interface-route-consolidation.doctest.md` for state/legacy routes,
old overlay entries, and explicit chat-about behavior. Test the real adapters;
do not substitute string searches for behavioral regressions.

A small route classification assertion prevents adding a production page under
the box shell without an ordinary workspace target or explicit utility role.
Retain existing UI-scan uniqueness assertions and update obsolete control IDs.
Browser tests reach mount retention, focus, mobile navigation and visible controls;
update the workspace tour with IC scenarios as repeatable evidence. Package
screenshots in one labeled exhibit. Physical-device results stay separate from
browser simulations. Test/line removal must not erase still-required behavior.

## Implementation order

1. A + G baseline: record current tree/counts and IC scenarios; consolidate `/card`
   and preserve explicit chat-about actions. Remove redundant ViewPage rendering.
2. B: migration cohorts, schema seeds, location guards, initialization/postconditions.
3. C: Questions and Landmarks canonical bodies/entries; retire page wrappers.
4. D: History state/body parity, authored-card adapter, deep links and page removal.
5. E: Storage, Admin, capture aliases, complete utility-route classification.
6. F: remove alternate page/chat and generic preview rendering; preserve runtime;
   handle old history; reconcile plans/guidance and all tests/consumers.
7. G final: finish stage and cumulative accounting, replay IC-1 through IC-9,
   knowledge audits, cross-model review, and requested landing gates.

Execute serially in dependency order. Commit completed stages locally; do not land
stages separately or change deployed boxes during plan drafting.

## Rollout shape

Write each substantial regression before replacing its adapter. Done means the
named tests pass, all IC scenarios have evidence or an explicit unresolved manual
gate, no ordinary production content uses the alternate page layout, and the
removal report includes actual stage/cumulative measurements. Run test:changed and
required repository gates; hourly main full-suite remains the broad sweep.

Append the deterministic seed migration, never alter historical migration names.
Fresh installs seed all cards; upgrades preserve old-cohort validity until new
completion. Deploy runs the established sweep/docs refresh. Verify canonical
presence, manifest enrollment, and generated guidance per box; dirty skips remain
pending with reasons. Keep legacy URL adapters across deployment. No production
completion or full-plan completion claim while a required rollout/manual gate is
unresolved. Publish counts and verification boundaries together with the final
handoff; only land/push when the boxholder asks.
