---
title: "Interface as cards — canonical Dashboard, Settings, and Browse"
status: partial
workstream: interface-as-cards
issues:
  - ../../../issues/closed/features/2026-09-08-dashboard-workspace-tab.md
---
# Interface as cards — canonical Dashboard, Settings, and Browse

Open Dashboard, Settings, and Browse alongside other cards without leaving the
workspace. Give each a real, canonical card address, type-inferred rendering,
and a notes margin; keep the existing pane controls and conversation ownership.

**Issues addressed:** [Dashboard tab](../../../issues/closed/features/2026-09-08-dashboard-workspace-tab.md)
is resolved by this plan. Its older “Do not require a synthetic on-disk card”
proposal is superseded by the boxholder's explicit choice of real canonical cards.
[Directory views](../../../issues/features/2026-07-28-directories-as-viewable-things.md)
is related but only partially addressed: Browse becomes one card, not a tab per
directory. [Route consolidation](../../../issues/code-quality/2026-08-02-card-vs-views-route-consolidation.md)
remains separate. [Chat everywhere](../../../issues/features/2026-08-30-chat-input-everywhere.md)
and [mobile presentation](../../../issues/features/2026-07-23-mobile-modal-not-split-pane.md)
remain open under their existing plans. They are deliberately absent from the
closure list above.

The [earlier design](../design/interface-as-cards-background.md) preserves the
broader subject/view/binding, tableau, and directory-head exploration. This plan
supersedes its direction for these three surfaces only; it does not authorize
those broader projects. The boxholder's September 6 framing belongs here:
“we basically have a windowing (tiled) system where chat is one part of it,”
with dedicated, split, and ambient chat, context brought into chat, and the
context the chat is in. The September 9 decision is to use that existing
container through ordinary open-card operations.

[Engineering review and dispositions](interface-as-cards.review.md) record the design review.

## Stated preferences this plan trades against

Direct boxholder decisions, September 9, 2026:

- Type infers the renderer. Bare `dashboard.card` already means type `dashboard`.
  A generic `system` type with `view: dashboard` was considered, not selected.
- Two dashboard cards are a likely error, not a supported customization feature.
  Multiplicity must be specifically expected before it is allowed.
- Settings remains discoverable from the profile menu, opening a well-known card.
- “I don't see why we'd change the panes at all, really.” Use `open card`.
- Browse is “one card that does all browsing,” accepting a directory parameter
  or state. Do not materialize cards for each directory.
- The dashboard renderer can reject cards outside its sole allowed location.
  This is intentionally lightweight and changeable later.
- Validation should reject deleting system cards, while allowing a defined
  migration transition with missing or moved cards.
- Implementation was authorized after approval of this plan.

[Engineering principles](../engineering-principles.md): §1 type structure,
§3 boundary validation, §4 visible failures, §7 predictable locations,
§8 one mechanism, §9 explicit essential state, §10 testable decisions, and
§11 enforced constraints. The directions below cite these preferences or
principles rather than treating earlier assistant suggestions as decisions.

## What already exists

Pre-implementation baseline, inspected September 9. Paths are relative to
`beebox/`; implementation has moved some cited lines. Quotes identify the
original boundaries, not claims that the removed adapters still exist.

| Evidence | Consequence |
|---|---|
| `src/shared/card-name.ts:7`: “Positional — bare `<type>.card`” | Reuse filename type inference; no new naming grammar. |
| `src/schemas/view.ts:62`: `cardSchema("view", {`; `:82`: “notes margin” | Existing generic instrument cards remain supported. New canonical types do not require a `view` property. |
| `src/cards/schema.ts:121`: `export interface CardValidateInput`; `:122`: `fields: Record<string, unknown>` | Schema-local validation has no path. Put location/presence checks in host validation, not a pretend schema path check. |
| `src/cards/schema.ts:135`: `export type CardCategory = "authored" \| "synced" \| "system"` | A catalogue category already exists; it is not a singleton or permission mechanism. |
| `src/lib/staged-files.ts:45`: `diffFilter: "ACMR"` | Deletions are absent from the staged-card list. |
| `src/core/card-lint.ts:117`: `content = await readFile(path, "utf8");` | Existing per-card lint reads disk; mandatory-presence checks need index reads for commits. |
| `src/cli/commands/validate-pre-commit.ts:129`: `diffFilter: "DR"` | Existing removal scanning is a separate seam, not mandatory-card enforcement. |
| `src/core/box/index.ts:149`: `const lines = MIGRATIONS` | Fresh initialization records all migrations; seed anchors before this completion state. |
| `src/core/box/defaults.ts:259`: `export async function installTodoView` | Reuse the template install precedent and preserve customization. |
| `src/cli/commands/migrate.ts:381`: `if (code !== 0 && code !== 2)` | Soft failure currently permits completion; the new migration must fail hard on an incomplete required set. |
| `src/cli/commands/migrate.ts:78`: `await appendManifestEntry(args.boxRoot,` | Administrative mark-applied also needs the required-card postcondition. |
| `src/core/migration-sweep.ts:121`: `await appendManifestEntry(boxRoot,` | Sweep records completion before its hooked commit; final-state checking must precede success. |
| `src/frontend/src/router.tsx:102`: `component: DashboardPage`; `:147`: `component: BrowsePageWrapper`; `:186`: `component: SettingsPage` | Three routed components need card adapters and legacy URL adapters. |
| `src/frontend/src/components/AppNav.tsx:80`: `id="bbx-profile-menu-settings"` | Preserve the profile entry and stable control ID. |
| `src/frontend/src/components/PlacePill-panels.tsx:264`: `id="bbx-box-menu-dashboard"` | Preserve this dashboard entrance. |
| `src/frontend/src/pages/browse/BrowsePage.tsx:64`: `onNavigate: (path: string, options?: BrowseNavigateOptions) => void` | Reuse the browser body, replace its route-bound state adapter. |
| `src/frontend/src/pages/browse/BrowsePage.tsx:176`: `useUrlView()` | Browse cannot simply be mounted in a card and continue reading the outer URL for its selected file. |
| `src/shared/view-state.ts:9`: `export type ViewState = Record<string, ViewStateValue>` | Existing JSON-safe state envelope; add a Browse-specific parser. |
| `src/frontend/src/components/chat/workspace/WorkspaceCanvas.tsx:50`: `onViewStateChange={(viewState) => workspace.updateTarget({ ...tab.target, viewState })}` | Push/replace method is currently dropped. Forward it for Browse history. |
| `src/frontend/src/components/chat/workspace/WorkspaceProvider.tsx:131`: `projectHistory(true)` | Target updates currently replace history. Extend this adapter, not the pane reducer. |
| `src/frontend/src/components/chat/workspace/WorkspaceCanvas.tsx:58`: “Card roots and the singleton transcript never change React parents on move.” | Preserve mount retention; do not recreate Settings or recording services on moves. |
| `src/frontend/src/components/chat/workspace/WorkspaceProvider.tsx:35`: `location.pathname.endsWith("/chat") \|\| location.pathname.includes("/views/")` | Canonical card routes already participate. Legacy routes should resolve to those targets. |
| `src/frontend/src/components/chat/everywhere/BoxConversationShell.tsx:40`: `workspace.participating ?` | As these routes join the workspace, their alternate attention/presentation paths become unnecessary; other excluded routes still need them. |

Repository searches for existing `dashboard`, `settings`, and `browse` card
schemas found no implementations to extend. The existing generic view registry
names landmarks, chat-picker, questions, and history; it does not supply these
three renderers (`src/shared/named-views.ts:148-168`).

## Prior art (external)

- [React state preservation](https://react.dev/learn/preserving-and-resetting-state):
  component position determines state retention. Keep the existing retained
  card mounts; a renderer extraction must not reset forms on pane moves.
- [TanStack navigation](https://tanstack.com/router/latest/docs/guide/navigation):
  search parameters and history state are separate, and `replace` chooses
  replacement versus a new entry. Browse uses existing view state serialization
  and forwards that choice through the workspace adapter.

Checked September 9. Neither framework supplies this project's canonical-card
or migration policy; those are local decisions. No external singleton framework
or window manager is needed.

## Tracks / scope

### A. Canonical identity and type-inferred rendering

**What / why:** Real anchors make the surfaces linkable and editable without
inventing a privileged card namespace. Exact locations prevent accidental
second instruments (direct preferences; principles 1, 7, 11).

**Implemented:** The shared table in `src/shared/system-card-paths.ts` defines
exactly these entries:

| Type | Canonical box-root-relative path |
|---|---|
| `dashboard` | `_config/interface/dashboard.card` |
| `settings` | `_config/interface/settings.card` |
| `browse` | `_config/interface/browse.card` |

The boxholder approved this directory. Use the table for renderer
checks, host validation, initial seed content, and navigation links. It is not a
box-writable registry, binding cascade, plugin API, or new generic schema policy.
The types have the existing global title fields and a markdown body for notes;
no required `view` field and no invented layout/configuration vocabulary. Seed
human labels Dashboard, Settings, Browse. Body is visible through source, not
inserted into the instrument UI. Additional configuration fields require an
actual product use and may be added later. Existing `view` cards are unchanged.

Each builtin renderer verifies the canonical normalized `data.path` before
rendering the instrument. A mismatch renders a localized error naming actual
and allowed paths, plus a link to the canonical card. It must not show a second
working dashboard. Raw/source inspection remains available to diagnose bad
cards. Use canonical shared path parsing, not independent slash heuristics.
Copies also fail host validation. A future type may deliberately support multiple
instances; no blanket singleton policy applies to all existing `system` category
cards (jobs and run records are plainly plural).

**Vocabulary lock-ins:** “canonical system card” names these three anchors;
“type” selects rendering; “view state” is temporary presentation state.

**First implementation chunk:** table, three minimal schemas, renderer-location
decision helper, and location validation tests. No pane or transport changes.

### B. Presence validation, initialization, and migration

**What / why:** Per-file validation cannot detect a file that has been removed.
Protection must evaluate the resulting box state, with a bounded transition for
upgrades (direct request; principles 3, 4, 11).

**Implemented:** The host-level invariant checks that required canonical
paths exist with the expected types and valid minimal contents. Full validation
checks the working tree. Pre-commit checks the candidate Git index, even on a
deletion-only commit, including staged renames and parent-directory removal.
An unstaged working-tree copy must not hide a staged deletion; an unstaged
removal must not reject an otherwise valid index. Check canonical copies' blobs,
not just path existence. Report exact missing/wrong path and repair guidance.
Run this independently of the staged-card ACMR filter and before success exits.
Do not change ordinary staged-card lint semantics as adjacent cleanup.

Use a registered, deterministic `canonical-interface-cards` bootstrap migration
and the same missing-only seed helper during initialization. Preserve existing
valid cards, their notes, and titles on rerun. Wrong content at a canonical path
or a noncanonical instance is a visible conflict, not permission to overwrite
or guess which copy to keep. Resolve conflicts before completion. Include
`_config/interface/` in the box-layout catalogue and generated guidance.

The migration middle ground is defined by the engine's canonical-path table
and the bootstrap completion record, not a general migration-mode bypass:

- Before bootstrap completion, missing new anchors are permitted by the presence
  rule. An ordinary commit still cannot remove an already present canonical
  anchor; compare HEAD and index for that deletion check. Malformed/noncanonical
  instances still fail. This admits old boxes and partially seeded boxes.
- The bootstrap script checks the final required set and exits **1** if it is
  incomplete. Never use soft-failure exit 2 for that condition: both runners
  accept 2 as applied. Re-running creates only missing anchors.
- The interactive runner and sweep verify this migration's postcondition before
  appending its completion entry. Initialization and administrative
  `--mark-applied canonical-interface-cards` / `--mark-all-applied` also verify
  the set before recording completion. Marking verifies already-installed data;
  it does not silently create missing cards. A manifest-less legacy box receives
  instructions to install/repair the anchors before administrative enrollment.
- Preserve the existing commit lifecycles. Interactive apply leaves changes for
  the operator's commit; the sweep commits with hooks and already restores its
  prior manifest on commit failure (`src/core/migration-sweep.ts:120-131`). The
  candidate index must contain the final cards whenever it contains completion.
  No new automatic interactive commit or dirty-work ownership journal.
- Pre-commit determines enrollment from HEAD plus the candidate index, not an
  unstaged manifest. An enrolled HEAD cannot opt out by deleting/rolling back
  its completion record. Once enrolled, the complete required set is mandatory.
  Full validation evaluates working-tree data and reports incomplete enrollment.
- A future actual relocation migration declares its specific old/new canonical
  paths in engine code. During its pending compatibility period the path guard
  and validation accept the declared old or new location; completion requires
  the new location and no competing instance. An enrolled candidate commit may
  move old to new but may not omit both. Temporary filesystem absence inside a
  transform is not a committed state. Do not introduce an exemption carrier,
  environment flag, or durable migration-mode switch now. If a future migration
  must commit an intentionally incomplete set, design that exception with that
  migration, rather than weakening this invariant in advance.

Normal validation and the renderer therefore have an explicit old-box middle
ground without blessing permanent deletion. Existing hook bypasses are not a
security boundary; this is protection against mistakes, not hostile box owners.

A missing card renders a named unavailable/migration-needed state. Opening a
surface does not create files or silently resurrect deleted content. Existing
raw inspection and operator migration tools remain the recovery route.

**Vocabulary lock-ins:** mandatory presence is a host invariant; migration
compatibility is specific to declared paths and completion, never a card capability.

**First implementation chunk:** candidate-state tests for deletion, rename,
wrong type, index/worktree divergence, bootstrap applicability, and manifest
rollback; then wire host validation and missing-only seeding to them.

### C. Dashboard and Settings as ordinary open targets

**What / why:** Their menus currently leave the workspace. Render the existing
instruments at their card addresses (direct preference; principles 8, 10).

**Implemented:** Type renderers wrap the existing route-independent
DashboardPage and SettingsPage bodies. Keep current behavior,
queries, mutations, error states, and controls. Menu entries use the existing
open-card path with canonical targets. Where a menu is outside the workspace
provider, use the canonical card href handled by that path; do not move provider
ownership merely to give a menu a hook. Preserve native-shell route flags through
the existing validated navigation helpers. Repeated opening reuses the path's tab;
move/focus/close/mobile projection remain the pane plan's behavior. Closing a
tab does not delete its backing file.

Settings card content is not settings values. Pairing, password, connector,
and theme controls keep their current state/services and authorization. Never
serialize secrets, form inputs, grants, or DOM content into card frontmatter,
view state, URL, or chat context. Admin remains outside this conversion. A
renderer location check is not authorization and does not replace server checks.

Legacy `/dashboard` and `/settings` URLs replace into `/views/<canonical-path>`
once, preserving explicit conversation intent and avoiding duplicate history
entries. Update in-body links such as Settings’ Back to Dashboard too. Source menus use canonical links; keep old URLs as compatibility entry
points, not parallel page renderers. Do not consolidate every `/card` and
`/views` route here. Retain the existing shell/input/pane ownership and storage
keys, including per-conversation arrangements.

Cold entry requires a specific frontend route-intent adapter. Today
`src/frontend/src/components/chat/everywhere/conversation-intent.ts:58` says
`if (chatPage) return { kind: "default" };`; do not replace legacy instrument
URLs directly into a cold `/chat?card=...` that loses their semantic place.
Use `/views/<canonical-path>` as the compatibility/copy-link entry form.
Extend `use-conversation-route.ts` to parse the full target, including search
and Browse state, before calling the existing intent decision. For canonical
Dashboard/Settings, supply an initial landmark request for root. For Browse,
supply its parsed directory through the existing cold `browseDir` branch and
suppress `cardPath` for that cold inference. Normal cards retain their existing
card request. Keep the existing explicit-session, remembered-selection, and
warm-navigation precedence ahead of this initial inference. No change to
`openForCard`'s wire shape or send binding is needed. Workspace may continue
projecting a resolved arrangement into its existing `/chat` history form.

Warm opens preserve the recipient. Attention identifies the actual canonical
card and safe view state; Settings publishes identity only. Preserve explicit
landmark selection semantics. These changes belong to target adapters, not a
new recipient controller.

**Vocabulary lock-ins:** a menu is an entrance to a card, not its identity.

**First implementation chunk:** Dashboard extraction plus canonical open/legacy
adapter and repeated-open/recipient regression. Settings follows through the
same path with safe-context checks.

### D. One Browse card with owned navigation state

**What / why:** A directory is the browser's current location, not the identity
of another Browse card (direct preference; principles 1, 8, 9).

**Implemented:** The canonical tab target always remains `browse.card`. Its
view-state shape is parsed at the renderer boundary:

```ts
type BrowseState = {
  directory: string;  // canonical box-root-relative; empty string is box root
  detail?: {
    path: string;
    viewer: string | null;
    params: Record<string, string>;
    viewState: ViewState | null;
  };
};
```

`detail` uses the structured ViewTarget shape, including the selected file's
renderer, params, and nested viewState. Only serialize at URL boundaries; avoid
a second URL encoded inside the outer state. Validate through shared ref/target parsing;
a selected detail's parent must match directory. Reject a directory as detail.
Filesystem/query results determine file/directory kind; do not extend the
existing extension heuristic to new state validation. Errors display the bad
location and an explicit return-to-root action, not silent fallback.

An opening `?dir=<box-root-relative-directory>` seeds directory if no view state
was supplied. Explicit valid view state wins; consume `dir` into state and remove it from target params so stale
seed parameters cannot override later navigation. A bare open selects an existing
Browse tab without resetting its state; if none exists, start at box root.
Explicit `dir` or viewState updates an existing tab. No browsing action edits
the card's frontmatter/body. Tab title stays Browse; breadcrumbs show location.

Keep the existing listing and file detail interaction for this scope:

| Action | State/history behavior |
|---|---|
| Click directory or breadcrumb | Update directory, clear detail, push view-state entry; keep the same tab. |
| Select file in listing | Keep directory, set detail, push. |
| Follow link inside detail | Preserve current in-Browse navigation semantics, update directory/detail, push; same-file renderer/parameter changes replace. |
| Change selected file's own view state | Replace or push its nested detail target as requested, through the outer Browse state callback. |
| Close file detail / return to listing | Clear detail and replace, matching current Browse behavior. |
| Explicit open-in-workspace action | Use existing open-card operation; retain Browse's location. |
| Back/Forward | Restore the recorded Browse state and existing arrangement/recipient history, without a fresh open that relocates the tab. |

Extract BrowseBody to take state and navigation callbacks. Remove its dependence
on outer route splats/search for the selected file. Thread the existing
`onViewStateChange(next, method)` method through WorkspaceCanvas and
WorkspaceProvider.updateTarget, and enable push-capable state where the
workspace owns history. This is adapter work: do not change pane actions,
layout, tab identity, preview policy, or arrangement storage version.

Legacy `/browse/<path>` replaces into `/views/<browse-card-path>` plus
directory/detail state,
preserving file viewer/params/state. Root, directory, file, and `.attach` paths
must be covered. Directory links intended for browsing construct the same target;
ordinary file/card links outside Browse keep their existing open behavior.
Directory state must survive reload and explicit links. Live listing refresh
continues to follow the current directory; hidden Browse cannot steal app-bar
place or chat attention from another visible card.

Cold Browse entry resolves conversation from its represented directory using
the existing cold-browse rule. Later browsing changes attention only. Retain the
Browse card's address plus validated directory/detail state in attention so the
agent can distinguish the instrument from what it shows, without scraping UI.

**Vocabulary lock-ins:** directory is view state; Browse is one canonical card;
selected file is nested detail state, not another outer pane.

**First implementation chunk:** pure Browse state/legacy-URL parser and history
adapter regressions, including same-tab reuse and Back; then adapt the body.

### E. Guidance and removal of replaced adapters

**What / why:** Agents must know the canonical addresses and remaining scope;
parallel routed implementations would preserve the original inconsistency
(principles 7, 8, 12).

**Implemented:** Generated schema guidance and box docs teach the three types,
locations, notes, deletion protection, Browse state, and migration repair.
Keep system category usage descriptive; it does not mean all system-category
cards are singletons. Update source/profile navigation to canonical targets.
Remove the replaced page implementations and obsolete pathname inference
only after the canonical-target cold inference in C is installed. Keep legacy routes as thin adapters.

Do not delete BoxConversationShell, ambient observation, native bindings, or the
remaining nonparticipating-route overlay protocol. Verify each removed branch's
callers; only these three surfaces are moving. The parent design's goal of
reducing chat-everywhere is met here through fewer exceptional page paths.

Keep the existing attention wire enum unchanged for compatibility with other
clients. These card-rendered instruments publish `surface: "card"`; old
`browse`/`dashboard` values remain accepted. No native protocol migration is
needed. Agent guidance teaches the canonical ref plus parsed Browse state as
the represented location.

**Vocabulary lock-ins:** retain existing conversation/attention distinction.

**First implementation chunk:** guidance and audits alongside each type; final
caller inventory removes only dead adapters after C/D have passed.

## Could this be simpler?

The smallest usable implementation is three actual cards, type renderers with
exact-path guards, and ordinary open-card links. That is the chosen UI model.
No universal resolver, system-card superclass, configurable role binding, new
pane type, or tableau service is necessary.

Renderer guards alone fail when the only card is deleted. The candidate-state
presence check and bootstrap compatibility address the boxholder's explicit deletion
and upgrade requirement (§11). Browse's state/history adapter is necessary for
Back within one card (§9); rewriting the pane reducer buys nothing here.

## Subplans

None. Bootstrap and its validation transition are bounded parts of this plan,
not a staged long-lived migration project. Earlier tableau, directory-head,
and ad hoc-content explorations are not subplans or prerequisites.

## Failure modes

Tracks A–E are implemented. The table names their validation boundaries; current
execution evidence and remaining walkthroughs are recorded below.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Copy dashboard to a second path | Location doctest + DOM check | A adds renderer and lint errors | Clear, canonical link provided |
| Stage deletion while a working-tree copy exists | Real-index doctest | B checks index blobs | Clear commit rejection |
| Delete parent directory or change required type | Candidate-state doctest | B mandatory shape check | Clear rejection |
| Bootstrap stops after one card | Migration retry fixture | B missing-only retry, no completion | Clear pending migration |
| Administrative mark-applied claims missing cards installed | Mark-applied/mark-all/init tests | B checks the required post-state at every enrollment entry | Clear refusal |
| Migrator reports partial success | Runner regression | B strict final postcondition | Clear, no completed manifest |
| Completion is rolled back to evade protection | HEAD/index manifest test | B enrolled HEAD remains mandatory | Clear rejection |
| Upgrade overwrites customized notes | Rerun/conflict fixture | B preserves or reports conflict | Clear conflict, no overwrite |
| Browse drops history method | History regression + DOM Back/Forward | D forwards push/replace | Back restores prior location |
| Malformed/escaping directory or detail | Boundary doctest | D parse error, explicit root action | Clear invalid location |
| Bare Browse open resets prior location | Open-intent regression + DOM check | D omission preserves target state | Location remains visible |
| Hidden Browse reports its location as focus | Visibility/selection regression | D visibility-scoped publication | No wrong recipient/context |
| Settings publishes a password through context/state | Sentinel data test | C identity-only attention, no form serialization | No disclosure |
| Cold system card selects `_config/interface` chat | Cold-entry regression + fresh-session DOM check | C/D resolve semantic entry place | Correct visible recipient |
| Legacy route makes two tabs or history loop | Route adapter regression + DOM check | C/D single replacement intent | One target, Back works |

No new path is accepted as silently failing; these handlers and tests are part
of completion, not discretionary follow-up work.

## Agent-flow / user-flow edge cases

- **ADDRESSED — wrong type/property:** A teaches `dashboard.card`, with no
  `view: dashboard` requirement. Existing generic view cards stay valid.
- **ADDRESSED — stale/moved canonical ref:** A/B name the required path and
  migration state; renderer never pretends the moved copy is canonical.
- **ADDRESSED — two writers:** bootstrap uses create-if-absent semantics and
  never overwrites agent edits; conflicting content blocks completion (B).
- **ADDRESSED — hand-edit drift:** host type/location checks plus normal schema
  validation; source remains inspectable (A/B).
- **ADDRESSED — fabricated directory:** D validates the path and uses actual
  lookup results; a missing location is shown, never redirected silently.
- **ADDRESSED — deletion UX:** B reports “Required system card missing from
  proposed commit: <path>” with restore/migrate guidance.
- **ADDRESSED — migration transition:** B admits unseeded old boxes and declared old/new locations, requires strict
  completed state, and never installs a persistent bypass.
- **DEFERRED — multiple independent Browse instruments:** this plan intentionally
  reuses one path/tab; later multiplicity requires an explicit product decision.

Walkthroughs to replay before implementation signoff (desktop and mobile):

- **IC1:** With chat and a memo open, open Dashboard twice, move/focus it, then
  return to the memo. One Dashboard tab; same recipient and draft.
- **IC2:** Open Settings from profile, move it, close its tab, reopen. Existing
  settings controls work; secrets never appear in the copied URL or chat input.
- **IC3:** Open Browse at a directory, enter a child, select a file, change that
  file's view, then Back through those entries. One Browse tab throughout.
- **IC4:** Open Browse with explicit directory while it is already open, then
  invoke bare Browse. Explicit input changes location; bare input retains it.
  Reload and open a copied state URL in a fresh tab; directory/detail agree.
- **IC5:** Keep Browse mounted but hidden, focus another card, dictate/send,
  and inspect a background reply. Browse cannot retarget or overwrite attention.
- **IC6:** Open legacy dashboard/settings/browse links cold and warm. No duplicate
  page outlet or tab; valid existing recipient rules and mobile Back behavior.
- **IC7:** Copy dashboard to a wrong path, stage deletion of the canonical file,
  and exercise a partial bootstrap in a disposable fixture. Errors are specific;
  migration retry preserves notes and restores a valid final set.

## NOT in scope

- Pane reducer, layout controls, tab identity, per-conversation storage ownership,
  or server tableaux: the boxholder explicitly retained the pane model.
- Chat husk transcript rendering, ordinary chat tabs, recipient transport,
  recording, native emission protocol, ambient reply semantics: already owned
  by chat-everywhere and pane-controls.
- Turning every existing page into a card in this batch: these three prove the
  pattern; Landmarks/History/Questions already have separate instrument work.
- Dashboard redesign or markdown composition: preserve the current instrument.
- General system-type partitioning, permissions by location, singleton schema
  metadata, or arbitrary root binding configuration: exact paths suffice.
- Directory-head cards, claiming, attachment migration, and per-directory
  presentation cards: Browse state does not require them.
- Ad hoc newly authored content and TTL cards: their lifetime remains unresolved.
- General route consolidation, fragment addressing, saved sets, landmark pinning,
  review queues, open-link styling, and agent show-card tools: related issues
  remain open; none is required to open these canonical cards.
- A new preview replacement preference: retain Browse's existing file-detail
  behavior and the workspace's existing explicit-open policy.

## Open design questions

The boxholder approved `_config/interface/` as the canonical directory, root as
the initial Browse location, and existing file-detail behavior within Browse.
Future optional instrument fields and which future types allow multiple
instances remain outside this plan.

## Knowledge audits

The audit suite includes `knows_directly` cases for canonical interface-card paths/type inference,
notes versus live state, one Browse card with directory state, and restoring a
required card versus running a declared migration. Run the relevant audits against
the isolated test box after implementation and generated-doc refresh; record
results. The three interface-card audits passed against installed guidance in a disposable
clone on September 9; the live test box was not reset.

## What will hold this after it ships

Use the existing tiers in [testing](../testing.md). Implemented test files include:
`test/shared/system-card-paths.doctest.md`,
`test/cli/commands/validate-system-cards.doctest.md`,
`test/core/migrations/canonical-interface-cards.doctest.md`, and
`test/frontend/browse-card-state.doctest.md`.

Index tests must use a real temporary Git repository with deliberately different
HEAD/index/worktree states. Migration tests run the actual runner and assert
manifest completion behavior; a seed-helper-only test is insufficient. Extend
`test/frontend/workspace-pane-navigation.doctest.md` and
`test/frontend/workspace-panes.doctest.md` for method propagation, restore versus
open, repeated target opens, and unchanged conversation binding. Use renderer
and browser tests for path rejection, Settings context exclusion, Browse nested
state, and visible focus. No new test framework or pane testing model.

Replay IC1–IC7 in the real local UI. Package useful desktop/mobile screenshots
and captions into one `fyi` exhibit. Browser/simulator evidence must not be
reported as physical-device verification; physical iPhone recording/navigation
remains a separate existing manual gate. Run appropriate frontend/backend type,
lint, and doc checks. Cross-model review is required before implementation is
called complete.

## Implementation order

1. Re-read current paper-cards/chat-everywhere changes and local guidance; retain
   their ownership and pane semantics. Refresh citation lines after integration.
2. A: canonical paths, schemas, path guards and unit tests.
3. B: presence/index checks, bootstrap compatibility policy, initialization/bootstrap,
   real-run migration tests, box layout and generated guidance.
4. C: Dashboard and Settings bodies, menu opens, compatibility routes, cold/warm
   recipient and safe-context tests.
5. D: Browse state parser, push/replace adapter, body extraction, legacy conversion,
   nested detail state and focus/history tests.
6. E: remove dead surface adapters, complete guidance/audits, replay walkthroughs,
   run cross-model review and required checks.

These are logical implementation boundaries, not independent shipping stages.
Implementation was authorized by the boxholder; landing and deployment remain
separate from local verification.

## Rollout shape

Write the named boundary/index/migration/history regressions before each
substantial path. Done means all failure-mode cases, IC1–IC7, required checks,
and knowledge audits pass with explicit evidence and device limits.

New boxes seed canonical cards before they are considered initialized/applied.
Existing boxes run the registered bootstrap migration before canonical entry
routes are expected to work. Partial seeding is safe to retry; completion requires
all final cards, not merely a successful script exit. Missing/dirty/conflicting
boxes remain visibly pending; do not mark convergence from one local run.
Deployment refreshes generated docs after migration, with per-box completion
and retained notes verified. Local verification seeded the isolated worktree test box only. Production
convergence remains a deployment follow-up; local evidence does not establish it.

## Implementation evidence — September 9

- Canonical schemas, renderer guards, missing-only bootstrap, strict completion,
  and staged-index protection are implemented. Real index and migration tests
  cover conflicting locations, deletion masked by working files, HEAD enrollment,
  partial retries, administrative completion, and retained notes.
- Dashboard/Settings use existing bodies through type renderers. Browse retains
  its listing/detail body and owns directory/detail state. Ordinary card opening
  and per-conversation pane storage remain the container. Removed Browse's routed
  wrapper; the three legacy routes now adapt to canonical card targets.
- Real profile-menu testing caught missing leaf params in the shell and a
  duplicate renderer-query projection. URL fallback and query-consumption
  regressions now cover both. No pane reducer changes were needed.
- Final affected suite: **417 files, 5,504 assertions, all passed**. The initial
  run exposed only initialization-fixture expectations in inventory/init/maps/
  gitignore; those were updated and rechecked. Final review regressions passed
  22 candidate-state assertions and 9 selection-context assertions. The separate
  Browse/navigation rerun passed 54 assertions.
- Three Claude knowledge audits passed using installed docs and schema guidance.
  The canonical-address audit accepts either the combined doc or generated schema
  docs; all path/type/duplicate answer requirements remain enforced.
- Backend/frontend/user-story/tooling typechecks, changed-file lint, doc-check,
  and whitespace checks passed after the review fixes. The implementation review
  and dispositions are in the companion review document.
- DOM/history walkthroughs verified repeated Dashboard reuse with a memo,
  move/focus and draft/recipient retention, profile and legacy Settings entry,
  Browse directory/detail Back/Forward, nested Source rendering, explicit versus
  bare Browse opening, reload, fresh-session directory inference, and the
  wrong-path renderer repair link. A temporary invalid-card fixture was removed.
  Mobile Show conversation/Show cards controls were exercised; no physical
  dictation, native emission, or background-reply replay is claimed.
- The `Interface cards: local verification` fyi exhibit records scenario-by-
  scenario evidence. Screenshot capture stalled in normal and fresh browser
  sessions; the one returned image did not match the observed DOM/viewport and
  was excluded. Reproduction is recorded in the existing
  [screenshot flake](../../../issues/bugs/2026-07-10-agent-browser-screenshot-flake.md).
  **Partial status reflects pending trustworthy visual/device signoff**, not
  an outstanding implementation or automated-test failure. Landing verification
  is recorded separately from production convergence.

## Finish scope assessment — September 9

All five implementation tracks are MET in the code. Visual/device acceptance and
production convergence remain PARTIAL, so this plan stays active as `partial`.
The requirements above describe the implemented contract; their imperative
wording is retained as acceptance criteria, not an unstarted implementation list.

| Requirement group | Status | Evidence |
|---|---|---|
| A: canonical identity, inferred type, notes, path rejection | MET | `src/shared/system-card-paths.ts:4`, `src/schemas/dashboard.ts:9`, `src/frontend/src/components/system-cards/SystemCardBoundary.tsx:11` and sibling schemas/renderers |
| B: index/HEAD protection, old-box transition, missing-only bootstrap and completion guard | MET | `src/core/system-cards.ts:83`, `src/core/system-cards.ts:96`, `src/core/migration-run.ts:114`, `test/core/migrations/canonical-interface-cards.doctest.md` |
| C: ordinary Dashboard/Settings targets, compatibility entry, recipient and safe context | MET | `src/frontend/src/renderers/system-cards.tsx:12`, `src/frontend/src/router.tsx:106`, `src/frontend/src/lib/system-card-navigation.ts:26` |
| D: one Browse target, nested state, history and visible attention | MET | `src/frontend/src/lib/browse-card-state.ts:47`, `src/frontend/src/renderers/browse.tsx:14`, `src/frontend/src/components/chat/workspace/WorkspaceProvider.tsx:128`, `src/frontend/src/components/chat/workspace/WorkspaceCanvas.tsx:50` |
| E: guidance/audits and removal of replaced routed adapters | MET | `docs/box/interface-cards.md`, `src/dev/knowledge-audits.yaml:9`, `src/frontend/src/router.tsx:153`; BrowsePageWrapper removed from `src/frontend/src/app-shell.tsx` |
| IC1–IC7 visual/device acceptance and production rollout | PARTIAL | DOM/history and automated evidence above; trustworthy screenshots, physical-device replay, and per-production-box convergence still unverified |

Future relocation policy is a constraint on a future migration, not an absent
implementation requirement of this bootstrap. General directory-card identity,
route consolidation, and mobile pane redesign remain explicitly out of scope.

Finish smoke caught obsolete test assumptions introduced by this conversion: the
privacy scan omits controls inside rendered cards, Browse no longer uses a
`/browse/<file>` URL, and the workspace's “Focus card” button matched the old
global card-row search. The walk now scopes listing and detail snapshots, checks
the canonical Browse target, and starts an explicit root draft before asserting
a real recipient switch. All smoke steps passed locally, including a rendered
file detail and no uncaught browser errors; no screenshot capture is implied.
