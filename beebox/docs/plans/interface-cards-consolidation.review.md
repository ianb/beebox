# Plan Engineering Review — One workspace for interface cards

Claude Opus reviewed the draft against repository source on September 10, 2026.
The author checked and incorporated the findings below. This is a design review;
no browser reproduction or implementation verification is claimed. Admin's
presentation remains a pending boxholder decision.

## What already exists

The review verified the shared list/browser bodies, retained workspace runtime,
existing renderer state callbacks, thin Capture/Chats redirect components, and
single-card page wrappers. ViewPage's FileView is already excluded from rendering
by the participating workspace path. The file is removable after entry coverage.

## Prior art (external) — verified

The planner searched and read the official React state-preservation and TanStack
search-navigation results linked in the plan. The independent reviewer had only
read-only repository tools and did not independently browse them. The design uses
existing repository mechanisms rather than assuming a new framework capability.

## Stated preferences this plan trades against

The review confirmed type inference, finite canonical singletons, plural authored
History views, the existing pane model, and recipient/attention separation. The
historical Admin shell exclusion is a precedent, not a new human veto. The author
asked the boxholder to choose between an Admin card and separate shell.

## Could this be simpler? (verified)

Redirecting only `/card` is a useful smaller first stage, but does not remove the
alternate layout's History, Admin and Storage callers. A finite set of anchors is
sufficient; no configurable registry or pane redesign is required.

## Failure modes

The original draft omitted two silent transitions: a History filter could select
a chat recipient, and an Admin redirect could drop OAuth feedback. Both now have
explicit handling and tests required by their implementation stages. Historical
migration seeding must also be cohort-aware, not only presence validation.

## Agent-flow / user-flow edge cases

Partial migration, hand-edited anchors, and stale links are covered by B and the
legacy adapters. History defaults, empty filters, outer recipient state, nested
card state, and OAuth inputs now have separate ownership. Actual validation awaits
implementation and the IC walkthroughs.

## Findings

### History session filter collides with recipient selection

**Location in plan:** Track D.
**Citation:** `src/frontend/src/lib/system-card-navigation.ts:45` includes
`"session"`; `src/shared/named-views.ts:130-131` uses session as a History filter.
**Issue:** Blindly preserving shell parameters moves the filter into the outer
chat session; stripping shell parameters instead loses it.
**Why it matters:** Inspecting history silently changes the message recipient.
**Suggested action:** Normalize History query input into target filter state before
shell projection; test legacy History and authored saved-view links.
**Traces to preference:** Passive navigation must not select a conversation.
**Disposition:** Accepted. D distinguishes History input, nested card target and
outer chat recipient; the failure table and IC scenarios require coverage. Other
renderers keep their existing query semantics.

### Admin redirect loses OAuth feedback and reconnect inputs

**Location in plan:** Track E, conditional on Admin becoming a card.
**Citation:** `src/webapp/routes/admin.ts:75` builds `returnUrl`;
`src/frontend/src/components/admin/useGoogleServices.ts:74` reads
`params.get("google")`; `GoogleServicesSection.tsx:38` reads `reconnect`.
**Issue:** Those controls read the outer URL, which the workspace rewrites.
**Why it matters:** A successful connection looks unsuccessful, or a reconnect
link no longer directs the user to the relevant control.
**Suggested action:** Preserve notices/reconnect as one-shot renderer inputs and
keep the backend returnPath for in-flight grants.
**Traces to preference:** Preserve auth interfaces and visible state (§4).
**Disposition:** Accepted. E maps and consumes these inputs, keeps authorization
codes in the backend callback, and adds OAuth/reconnect cases to IC-7.

### Original migration still seeds the enlarged table

**Location in plan:** Track B.
**Citation:** `src/core/system-cards.ts:99` loops over
`Object.keys(SYSTEM_CARD_PATHS)`; `src/core/migration-run.ts:114,122` invokes
`assertSystemCardsComplete` for manifest gates.
**Issue:** Splitting enrollment alone changes the old script's write set.
**Why it matters:** An old pending migration could create all new instruments
under its historical marker and require the wrong postcondition on retry.
**Suggested action:** Pass cohort to seed, assert, manifest gates, dry-run output
and repair errors; test the old script after table growth.
**Traces to preference:** Explicit validated migration boundaries (§3).
**Disposition:** Accepted. The old script writes/requires three; new completion
requires eight. The failure matrix now tests this distinction.

### Canonical card link differs from projected workspace URL

**Location in plan:** Tracks A/E/F and IC-1.
**Citation:** `src/frontend/src/lib/system-card-navigation.ts:68` sets
`search.card = serializeViewUrl(input.target)`; WorkspaceProvider projects to chat.
**Issue:** Calling `/views` the sole canonical URL overlooked the address bar's
`/chat?card=` form and the `companion` entry adapter.
**Why it matters:** Copy/reload and legacy entry tests could miss real inputs.
**Suggested action:** Distinguish card link from workspace URL and list both.
**Traces to preference:** One mechanism with explicit essential state (§8, §9).
**Disposition:** Accepted. Vocabulary, inventory and IC-1 now include both forms;
F also audits AppNav's obsolete Admin pathname check.

### Citation offsets and abbreviated-hash mechanism

**Location in plan:** Evidence table and Track D.
**Citation:** `src/frontend/src/components/history/HistoryBrowser.tsx:93` searches
`c.hash.startsWith(initialHash)`; following code pages until it finds a match.
**Issue:** Several line numbers were stale, and the draft invented a special
hash-resolution endpoint instead of naming the paged browser search.
**Why it matters:** An implementer could build an unnecessary resolver.
**Suggested action:** Correct citations and reuse HistoryBrowser's mechanism.
**Traces to preference:** Cite actual reuse and avoid competing mechanisms (§8).
**Disposition:** Accepted. Citation offsets corrected; D names paged prefix
matching and its missing-commit behavior. Several offsets were already corrected
while the independent review was running.

## NOT in scope (verified)

No SDK changes, new pane model, saved-filter conversion, or broad modal removal.
The surviving recipient runtime is not counted as removable presentation code.

## Things I checked and found clean

The reviewer confirmed all template sections, track-level directions and first
chunks, linked issue existence, candidate file line counts, Knip configuration
absence, filter-push/commit-replace behavior, index-or-HEAD protection, fresh-init
ordering, ViewOverlay callers, and recipient-versus-presentation portions of
useConversationRoute. The planner independently measured the full frontend
baseline; the reviewer did not run shell counts. Doc-check and diff-check cover
the documentation artifact; they are not implementation tests.
