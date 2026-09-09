# Plan Engineering Review — interface as cards

Reviewed September 9, 2026 against the boxholder's decisions and current source.
Cross-model review used Claude Fable with read-only source access. Findings below
are adjudicated against the final [plan](interface-as-cards.md), not instructions
to expand scope. This opening section records the pre-implementation review; the implementation
review is recorded below.

## What already exists

Type inference, path-keyed pane tabs, retained mounts, and JSON-safe view state
are usable foundations. WorkspaceCanvas currently drops the state history method;
WorkspaceProvider replaces history on target updates. Existing per-card staged
validation neither includes deletions nor reads index blobs. The plan's source
table records these verified boundaries and their reuse limits.

## Prior art (external) — verified

[React state preservation](https://react.dev/learn/preserving-and-resetting-state)
supports preserving component identity across pane moves.
[TanStack navigation](https://tanstack.com/router/latest/docs/guide/navigation)
distinguishes search/history state and push/replace. These support the adapters;
neither supplies canonical-card validation or migration semantics.

## Stated preferences this plan trades against

The boxholder requires canonical singleton instruments, type-inferred renderers,
profile navigation to Settings, one stateful Browse card, unchanged panes, and
lightweight location/deletion checks with a migration middle ground. Earlier
multi-dashboard and tableau proposals have no authority over these choices.
Principles 3/4 require explicit failures; 8/9 favor existing state mechanisms;
11 supports enforceable deletion protection.

## Could this be simpler? (verified)

Three actual files and exact-path guards suffice for rendering and opening.
Candidate-index checks are needed for deletion protection. No system superclass,
new pane model, automatic interactive-migration commit, or general migration
bypass is needed. The final plan removed the initially proposed bypass carrier.

## Failure modes

The important failures are wrong cold recipient, staged deletion hidden by disk
contents, incomplete migration recorded as applied, and lost Browse Back history.
Each has a named planned handler and regression. No tests are claimed as run.
Administrative mark-applied and initialization are included in enrollment checks.

## Agent-flow / user-flow edge cases

The final plan covers copied anchors, missing anchors, incomplete bootstrap,
modified notes, explicit versus bare Browse opens, nested file view state,
hidden-card attention, and Settings state exclusion. Seven walkthroughs retain
stable IC1–IC7 identifiers for implementation verification.

## Findings

### Cold canonical entry needs semantic target inference

**Location in plan:** Track C, cold entry; Track D, legacy Browse conversion.
**Citation:** `beebox/src/frontend/src/components/chat/everywhere/conversation-intent.ts:58`:
`if (chatPage) return { kind: "default" };`.
**Issue:** A cold `/chat?card=...` adapter loses the distinction between root
instruments and Browse's represented directory. Ordinary card inference would
instead use the infrastructure card's enclosing directory.
**Why it matters:** The input can select the wrong conversation without an error.
**Suggested action:** Canonical `/views/` entry plus parsed-target inference before
the existing cold decision; preserve explicit/stored/warm precedence.
**Traces to preference:** Browsing changes attention, not the existing recipient;
principles 3 and 4 require a correct explicit initial binding.
**Disposition:** Addressed in C. The reviewer suggested extending backend
`openForCard`; the final plan instead supplies the existing frontend landmark
request after parsing the target, avoiding a wire-contract change. Do not delete
this replacement inference during Track E cleanup.

### Nested Browse detail should remain structured

**Location in plan:** Track D, BrowseState and attention.
**Citation:** `beebox/src/shared/view-state.ts:7`:
`| { [key: string]: ViewStateValue };`.
**Issue:** A serialized ViewTarget string inside serialized outer view state adds
unnecessary encoding and obscures the represented file in attention.
**Why it matters:** Nested view state and source attribution become harder to
parse and preserve correctly.
**Suggested action:** Store structured path/viewer/params/viewState and serialize
only at the outer URL boundary. Consume `dir` from params when normalizing state.
**Traces to preference:** One Browse card with existing state support; principles
1 and 8 favor the existing structured shape.
**Disposition:** Addressed in D. E keeps the attention wire enum compatible and
uses card identity plus state, rather than retiring native-compatible enum values.

### Migration transition does not need a general bypass

**Location in plan:** Track B, migration lifecycle.
**Citation:** `beebox/src/cli/commands/migrate.ts:391`:
`await appendManifestEntry(boxRoot,`; `beebox/src/core/migration-sweep.ts:121`:
`await appendManifestEntry(boxRoot,`.
**Issue:** The original runner-scoped allowance had no concrete carrier, and a
later draft unnecessarily changed interactive migration into automatic commits.
**Why it matters:** This expands the operator workflow and risks treating a broad
migration flag as permission to delete required anchors.
**Suggested action:** Keep existing commit lifecycles, check completed state at
enrollment paths, use HEAD/index for commit applicability, and make bootstrap
exit 1 on incomplete state. Design actual future moves against declared paths.
**Traces to preference:** The boxholder asked for a lightweight rule with a
middle ground; principles 8 and 11 favor explicit candidate-state checks.
**Disposition:** Addressed in B. No general bypass or new automatic commit. A
future migration requiring committed incomplete states needs its own decision.

### Completion checks must cover administrative enrollment

**Location in plan:** Track B and failure-mode table.
**Citation:** `beebox/src/cli/commands/migrate.ts:78`:
`await appendManifestEntry(args.boxRoot,`; `beebox/src/core/box/index.ts:149`:
`const lines = MIGRATIONS`.
**Issue:** Runner-only postconditions leave mark-applied and initialization able
to claim installation without the anchors.
**Why it matters:** An enrolled box would fail mandatory-presence checks immediately.
**Suggested action:** Verify the required set before every bootstrap enrollment,
including mark-all-applied and fresh initialization.
**Traces to preference:** Migration middle ground must end in a valid state;
principles 3 and 11.
**Disposition:** Addressed in B, with explicit planned tests. This was identified
by the primary agent while checking the independent migration trace.

## NOT in scope (verified)

No pane reducer/ownership rewrite, generic singleton framework, backend send
contract change, dashboard redesign, directory heads, or ad hoc lifetime system.
The directory-views and mobile issues remain open because this plan only overlaps
part of them. The earlier background remains preserved and subordinate.

## Things I checked and found clean

- All bbx-plan template sections are present.
- Quoted source boundaries for type inference, renderer registry, menus,
  retained mounts, and view-state method loss match current source.
- Corrected the migration-sweep quote and staged-removal citation line.
- The final scope preserves the existing pane and conversation storage identity.
- Proposed location and file-detail behavior are explicitly draft defaults.
- Documentation checks, local Markdown link existence, and diff whitespace checks
  passed for the planning changes; no code tests or knowledge audits were run.


## Implementation review — September 9

Claude reviewed the implementation with read-only source access, tracing the
changed state owners and callers. Four findings were adjudicated:

1. **Rejected: tolerate malformed migration JSON.** The review conflated invalid
   entry shape with invalid JSON syntax. `readManifest` also throws on malformed
   JSON (wrapped in `ManifestReadError`); it only skips successfully parsed entries
   of the wrong shape. Singleton enrollment continues to fail closed rather than
   silently treating a damaged manifest as an unenrolled box.
2. **Accepted: preserve nested selections.** Suppressing a Browse detail card's
   attention also suppressed its selection-to-chat sink. Separate selection
   eligibility from the detail's attention claim while respecting the enclosing
   Browse card's visibility.
3. **Accepted: ignore discarded copies.** Implicit working/index inventories now
   filter `isTrashedCard`, like sibling card walks. Required canonical presence
   remains mandatory, so moving the canonical card into trash still fails.
   Real-index regressions cover discarding a stray copy and restoring a canonical
   card while retaining a trash copy.
4. **Accepted: wire a bare Browse entrance.** The Box menu and Dashboard launcher
   now open the canonical Browse card without directory state. Existing tabs retain
   their location; a fresh tab starts at root, as already approved in the plan.
   Links naming a particular directory/file remain explicit navigation intents.

The UI walkthrough also found two defects before review: shell providers lack
leaf route params, and projecting a canonical target initially duplicated its
renderer query at the top level of `/chat`. Pathname fallback, fresh-entry
precedence, and single-consumption projection have regression coverage.
