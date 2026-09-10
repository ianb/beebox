---
title: "Follow a card after its path moves"
status: implemented
workstream: moved-card-forwarding
issues:
  - ../../../issues/closed/bugs/2026-09-08-moved-card-open-in-browser-404s.md
---
# Follow a card after its path moves

When an open card is renamed or moved, recover its current Git path only after the old path returns not-found. Return a typed recovery hint to the browser, and let the active card route replace its old URL with the new one.

**Issues addressed:** `2026-09-08-moved-card-open-in-browser-404s`

## Implemented outcome

- Routed viewers opt into recovery, and `card.get` invokes
  `resolveMovedCardPath` only from its existing `ENOENT` branch. Successful
  reads and non-navigable missing-card embeds do no Git recovery work.
- The resolver uses an ephemeral index and object directory for unstaged
  renames, then committed Git rename records for history and chains. It accepts
  only an existing, contained `.card` destination and lets a reused source path
  win through the ordinary read. The scratch Git process inherits the safe
  ambient settings needed for Git discovery, and a scratch failure still falls
  through to committed history recovery.
- The tRPC error formatter carries a discriminated `recovery` value without
  exposing Git diagnostics or absolute paths.
- Card, Views, the canonical chat workspace, and Browse replace their current
  location with the recovered path while retaining their renderer parameters,
  view state, conversation, pane placement, and keyboard focus. Browse lets a
  missing `.card` reach `card.get` so reloads and stale legacy links recover too.
- Real-Git doctests cover unstaged and committed moves, chains, directory
  moves, source reuse, unusual names, deleted and non-card destinations,
  containment through symlink rejection, and Git failure. Frontend and tRPC
  doctests cover the typed boundary, cached-data recovery, ancestor rename
  events, and workspace retargeting.

## Stated preferences this plan trades against

- The normal read path must remain exactly as direct as it is now. `card.get` reads the resolved path immediately (`src/webapp/trpc/routers/card.ts:147-156`: `const { relPath, fullPath } = await resolveCardPath(...)` followed by `raw = await fs.readFile(fullPath, "utf-8");`). Git recovery begins only inside the existing `ENOENT` branch. A found card causes no new Git command, file stat, cache lookup, or indirection.
- This is a rare recovery, so it must not create durable bookkeeping. The issue names a move ledger and Git history as alternatives (`../../../issues/closed/bugs/2026-09-08-moved-card-open-in-browser-404s.md:33-37`); this plan chooses Git's existing rename information and accepts best-effort coverage.
- The server and client exchange a discriminated recovery value, not a message convention. This follows engineering principle 1: “If the compiler cannot distinguish two concepts, the design has not finished distinguishing them” (`docs/engineering-principles.md:12-21`).
- Recovery must fail visibly to the server but safely to the person. The existing tRPC formatter prevents server frames and absolute paths from reaching clients (`src/webapp/trpc/trpc.ts:4-14`). Unexpected Git failures are logged, while the response remains the ordinary card not-found response, following principle 3 (“Resilient, never silent”) (`docs/engineering-principles.md:49-62`).
- No adjacent feature is included. Route consolidation, stable card identity, raw-file forwarding, and a new live-move protocol are outside this bug fix, consistent with the repository instruction to add no features beyond the task.

## What already exists

- `bbx move` already performs the filesystem rename and reference rewrites. The issue records that referrer refs, outbound refs, view refs, and Phase-2 card files are covered (`../../../issues/closed/bugs/2026-09-08-moved-card-open-in-browser-404s.md:19-26`). Reuse this behavior; do not change the move command.
- `card.get` already has the exact miss-only insertion point (`src/webapp/trpc/routers/card.ts:155-166`): after `fs.readFile` reports `ENOENT`, it throws `TRPCError({ code: "NOT_FOUND", message: ... })`. Add recovery there and nowhere before the read.
- The shared tRPC formatter is the safe place to add response metadata (`src/webapp/trpc/trpc.ts:8-15`). Extend its error data with a typed recovery union while retaining the current internal-error sanitization.
- Internal paths already have one canonical form (`src/shared/box-path.ts:11-25`): box-relative, forward-slash paths without a leading slash. Use that form in Git matching, the response hint, and route navigation.
- `resolveBoxNamespacePathOnDisk` is the common lexical and on-disk security boundary (`src/lib/box-namespace-resolve.ts:309-330`: “What every consuming route should call.”). Reuse it to validate the recovered destination instead of hand-rolling containment checks.
- Git readers are deliberately not locked (`src/lib/git.ts:19-24`), and `gitBoxPrefix` already translates between repository-relative output and a box nested under a package repository (`src/lib/git.ts:124-137`). Reuse both conventions.
- The file watcher already treats a rename as possibly replacing a whole subtree (`src/core/box/file-watcher.ts:338-342`) and emits one canonical `file-change.path` (`src/core/box/file-watcher.ts:423-427`). Reuse the event; broaden only the frontend's relevance check for an ancestor rename.
- `useFileData` already invalidates `card.get` after a matching file event (`src/frontend/src/components/file-view-data.ts:118-157`) and preserves cached card data when a refetch fails (`src/frontend/src/components/file-view-data.ts:167-188`). Recovery metadata must remain observable in that cached-data case.
- The frontend currently identifies ordinary missing cards by parsing `Card not found:` (`src/frontend/src/components/file-view-data.ts:60-67`). Keep that compatibility behavior for ordinary missing cards, but do not use message parsing for move recovery.
- `/card/$` and `/views/$` are separate routes (`src/frontend/src/router.tsx:201-213`). The filed route-consolidation issue confirms both remain live (`../../../issues/code-quality/2026-08-02-card-vs-views-route-consolidation.md:10-27`). The current workspace then canonicalizes a `/views/$` card into the chat route (`src/frontend/src/components/chat/workspace/WorkspaceProvider.tsx:34-73`), so both the route wrapper and the routed workspace need move handling.

## Prior art (external)

- Git's [`--name-status` and `-z`](https://git-scm.com/docs/diff-options) provide machine-readable status and NUL-terminated paths. Use NUL termination so spaces, tabs, quotes, and unusual filenames cannot corrupt pairing.
- Git's [`--find-renames[=<n>]`](https://git-scm.com/docs/diff-options) detects delete/add pairs as renames and defaults to a 50 percent similarity threshold. Keep that default: a missed forward is safer than forwarding to the wrong card.
- Git log's [`--full-diff`](https://git-scm.com/docs/git-log) makes a path limit select commits while showing the selected commit's full diff. This is necessary because limiting the diff itself to the missing source path loses the rename's destination.
- Git documents that exhaustive rename detection can become quadratic when many unmatched sources and destinations remain ([diff options](https://git-scm.com/docs/diff-options)). This lookup runs only after a miss, and the implementation must use Git's normal rename limits rather than raising them.

## Tracks / scope

### Track 1: Miss-only Git rename recovery

**What.** Add a small server helper that takes a box root and a missing canonical card path and returns:

```ts
type MovedCardResolution =
  | { kind: "moved"; path: string }
  | { kind: "not-moved" };
```

**Why this needs to change.** The move command knows both paths while it runs, but nothing durable connects a later browser request to that operation. Persisting a ledger would impose a new state lifecycle for a rare recovery. Git already contains rename candidates for both working-tree and committed moves.

**Direction.** Routed viewers opt into the helper, which is called only from the
`card.get` `ENOENT` branch. It:

1. Confirm that the missing source still does not exist. This makes a path reused by a new card win over any historical rename.
2. Inspect uncommitted card changes through an ephemeral Git index and object directory. Populate only the scratch index, then read its NUL-terminated rename diff. This is necessary because a normal diff omits an unstaged move's untracked destination; the scratch state is removed after the lookup and neither the working tree nor the real index changes. Match only an `R<score>` record whose old path exactly equals the current candidate.
3. If the working tree has no match, ask Git for the newest commit touching the candidate, with `--full-diff --name-status -z --find-renames`, and find the exact old-path rename in that full commit. This covers ordinary committed moves.
4. Translate repository-relative paths through `gitBoxPrefix`; reject destinations outside the current box prefix.
5. Follow a chain at most 16 hops. Stop on repetition, ambiguity, an unrecognized Git record, or no rename.
6. Accept only an existing `.card` destination that passes `resolveBoxNamespacePathOnDisk({ mode: "read" })`. Otherwise return `not-moved`.

Git command or parse failure is recovery failure, not request failure: log one warning with the canonical requested path and return `not-moved`. Never include Git stderr or an absolute path in the response. Do not infer a move from unrelated `D` and `A` records; only Git's `R` record is strong enough to forward.

**Vocabulary lock-ins.** “Moved” means an exact Git rename record from this box, ending at an existing safe card. `MovedCardResolution` is internal. The client-facing value is `recovery: null | { kind: "moved"; path: string }`, where `path` is canonical box-relative form.

**First implementation chunk.** Add the helper and a real temporary-Git-repository doctest covering working-tree rename, committed rename, a chain, path reuse, a missing destination, unusual path characters, and a non-repository/Git failure. Then call it exclusively in `card.get` after `ENOENT` and attach a typed cause to the existing `NOT_FOUND` error.

### Track 2: Typed not-found recovery response

**What.** Extend the tRPC error shape with:

```ts
recovery: null | { kind: "moved"; path: string };
```

**Why this needs to change.** A browser can act on a move only if the server distinguishes it from an ordinary missing card. Parsing display text would make protocol behavior depend on wording and would fail the typed-boundary principle.

**Direction.** Give the miss branch a dedicated typed error cause that contains only the validated destination. The global error formatter recognizes that cause and serializes the discriminated recovery value. All other errors receive `recovery: null`. Keep the HTTP/tRPC semantic code `NOT_FOUND`: the requested old resource is absent, and the value is recovery metadata rather than a successful card response.

**Vocabulary lock-ins.** The server field is `recovery`; its first and only variant is `{ kind: "moved", path }`. Do not add `movedTo` to an error message or create a second ad hoc shape.

**First implementation chunk.** Extend the formatter and its existing doctest to prove moved metadata survives serialization, all unrelated errors return `recovery: null`, and absolute server paths remain absent.

### Track 3: Route-owned URL replacement

**What.** Expose the typed recovery from `useFileData` through `FileView`, and let the owner of each navigable card surface replace its URL.

**Why this needs to change.** `FileView` knows that the data request moved, but it does not own the meaning of `/card`, `/views`, or Browse history. The route owner can preserve its own route family and query/view state without putting router knowledge into the shared viewer.

**Direction.** Add `recovery` to `LoadResult` and an optional `onMoved(path)` callback to `FileView`. Extract recovery directly from typed tRPC error data, including when a failed refetch has cached card data and is otherwise classified as stale. When `recovery.kind === "moved"`, invoke the callback once for that source/destination pair and keep the current card visible until navigation replaces it.

The route owners respond as follows:

- `/card/$` replaces only its splat and preserves its current search/view state.
- `/views/$` replaces only its splat when it remains mounted. When the existing workspace canonicalization changes it to `/chat?card=...`, the workspace retargets the same tab and replaces the `card` search value while preserving its pane, renderer state, conversation, and other search values.
- Browse replaces its selected-card path through its existing navigation owner and keeps the Browse route and current search state.

All use history replacement, not push, so Back does not return to the dead address. Other embedded or companion `FileView` instances that do not own a routed URL retain current missing/stale behavior; they must not navigate the whole application.

For a directory move, change the file-event relevance predicate so an exact path change remains relevant and a `rename` of an ancestor directory is also relevant. That event only causes the existing normal `card.get` refetch. If the card exists at the old path, the normal read succeeds and Git is never consulted; if it misses, Track 1 runs.

**Vocabulary lock-ins.** `recovery` is data state; `onMoved` is the navigation handoff. “Follow” in this plan always means replace the current route's path while preserving its route family and search state.

**First implementation chunk.** First add pure doctest coverage for typed recovery extraction, cached-data recovery, exact-versus-ancestor event relevance, and workspace-tab retargeting. Then wire `onMoved` into `FileView`, Card, Views/their canonical chat workspace, and Browse and verify the routed surfaces in the real browser.

## Could this be simpler?

The smallest fix is to put the new path in the 404 message and have one page parse it. That is smaller in lines, but it silently leaves `/views/$`, Browse, cached-data live refresh, and directory moves broken, and it makes behavior depend on prose. This conflicts with the typed-boundary principle and the issue's known parallel routes.

The next-smallest fix is the plan above: one best-effort Git query after a miss, one typed error variant, and route-local URL replacement. A ledger, cache, new event type, generalized redirect service, or stable card identifier would add ongoing state or protocol for cases this bug does not require. They are rejected.

## Subplans

None. The Git lookup, typed error shape, and three existing route adapters are bounded and have no unresolved design dependency.

## Failure modes

No critical gap remains in the planned behavior. Deliberate heuristic misses preserve the current clear not-found state rather than silently choosing a destination.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The old path has been reused by a different card | Real-Git doctest | The normal read wins; recovery is never called | Clear: the new card opens |
| An uncommitted rename is present | Real-Git doctest | Working-tree rename scan runs first | Clear: URL follows the card |
| A committed rename is present | Real-Git doctest | Latest touching commit is inspected with full diff | Clear: URL follows the card |
| The card changed too much for Git's rename threshold | Resolver's `R`-only contract | No `R` record means no forwarding | Clear: ordinary missing-card UI |
| Git is unavailable, the box is not a repository, or output is malformed | Real-Git and parser doctests | Warn once and return `not-moved` | Clear to server log and ordinary UI |
| A rename chain loops or exceeds 16 hops | Bounded resolver loop | Stop and return `not-moved` | Clear: ordinary missing-card UI |
| The destination was deleted, is not a `.card`, escapes the box, or is a disallowed symlink | Real-Git doctest | Validate the final path through the namespace resolver | Clear: ordinary missing-card UI |
| A directory rename emits only the ancestor path | Event-predicate doctest and browser check | Ancestor `rename` triggers the existing refetch | Clear: URL follows the card |
| A live refetch fails while React Query retains the old card | Frontend doctest | Recovery is extracted separately from visible/stale data | Clear: route replaces while old card stays visible |
| Routed surfaces interpret the recovery differently | Browser matrix for Card, canonicalized Views/chat workspace, and Browse | Each owner preserves its route state and uses replace | Clear: address bar shows canonical destination |
| A destination contains tabs, spaces, or quotes | Real-Git and parser doctests | NUL-delimited parsing | Clear: exact destination or ordinary missing |
| The error formatter receives an unrelated error | Formatter regression | `recovery: null` | Clear: existing error behavior |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED (Tracks 1 and 2).** The protocol has one discriminated `recovery` variant. There is no free-form destination field to guess.
- **Stale ref — ADDRESSED (Tracks 1 and 3).** This is the core case: after a miss, the route follows an exact Git rename to an existing card.
- **Two agents touching the same card — ADDRESSED (Track 1).** The source-exists check and final destination validation fail closed if the working tree changes during recovery. A newly reused source wins on the next normal request.
- **Hand-edit drift — ADDRESSED (Track 1).** Only Git `R` records are accepted; a hand-written ledger or redirect cannot drift because none exists.
- **Fabricated free-form value — ADDRESSED (Tracks 1 and 2).** The server derives and validates the path; neither an agent nor the browser authors it.
- **Validation error UX — ADDRESSED (Track 1).** Invalid or unsafe candidates remain the existing ordinary missing-card UI; detailed diagnostics stay server-side.
- **Partial migration / transition state — ADDRESSED.** There is no data migration or stored state. During code rollout, old clients ignore the extra error field and retain today's missing state; new clients understand it.

## NOT in scope

- A `_bookkeeping` move ledger, cache, tombstone, or change to `bbx move`; the uncommon recovery does not justify new durable state.
- Proactive push of a “path moved” event. The existing file-change event causes a normal refetch, and recovery begins only if that refetch misses.
- Redirects for `/api/files`, `/api/image`, or `/api/images`. Re-rendering the moved card loads its resources from the new path; direct historical asset URLs and old chat transcript refs belong to `2026-09-07-chat-history-still-references-pre-migration-paths`.
- Consolidating `/card/$` and `/views/$`; that remains the separate route-consolidation issue.
- Stable path-independent card IDs or addressable URIs; that is a broader identity design.
- Guessing a rename from a delete plus an add, lowering Git's similarity threshold, or special handling for moves introduced only by a merge commit. A false forward is worse than a visible miss.
- Navigating inline chat cards, overlays, figures, or non-routed companion views. Only surfaces that own a card URL, including the routed chat workspace, provide `onMoved`.

## Open design questions

None. The deliberate limits above are accepted product behavior for this best-effort, miss-only fix rather than unresolved design choices.

## Knowledge audits

Skip. This is browser/server recovery infrastructure and introduces no box-agent instruction, card schema, authoring convention, or concept an agent must know.

## What holds this

- `test/core/moved-card-forwarding.doctest.md` creates actual temporary Git repositories instead of mocking rename output. It covers working-tree and committed renames, chains, path reuse, unusual filenames, missing/unsafe destinations, and graceful Git failure. This keeps the risky interpretation of Git behavior executable at the doctest tier.
- The existing tRPC error-shape doctest asserts the serialized recovery union and the no-path-leak boundary.
- Focused frontend doctests keep recovery extraction and ancestor-rename relevance as pure functions. They specifically cover React Query's cached-data plus refetch-error state and atomic workspace-tab retargeting.
- Browser verification exercises an uncommitted move in the isolated workstream test box across Card, Browse, and the chat workspace that `/views/$` canonicalizes into, including exact query/view-state preservation.
- No new test tier or scheduled tour is needed. The pure decisions and real Git behavior fit existing doctests; the browser pass verifies integration rather than carrying the regression alone.

## Implementation order

1. Add the real-Git doctest, then the miss-only `MovedCardResolution` helper. Keep all production call sites absent until its fail-closed behavior is green.
2. Add tRPC formatter regressions, the typed moved cause, and the `card.get` call inside the existing `ENOENT` branch. Verify a successful `card.get` has no recovery work.
3. Add frontend pure regressions for recovery extraction and ancestor rename relevance, then expose `recovery` and `onMoved` through `useFileData` and `FileView`.
4. Wire history replacement into Card, Views/their canonical chat workspace, and Browse without consolidating them. Run the browser scenario matrix.
5. Run focused doctests, `pnpm typecheck`, `pnpm lint:changed`, `pnpm test:changed`, and `git diff --check`. Update the issue with the final verification evidence only when the implementation is complete.

## Rollout shape

Tests land with each implementation chunk and precede its production code. Done means the real-Git, tRPC-shape, frontend recovery, and workspace reducer doctests pass; the repository typecheck and changed-file lint/test gates pass; and the isolated browser matrix demonstrates URL replacement for an uncommitted move on Card, Browse, and the canonicalized Views/chat workspace. Committed, chained, directory, and path-reuse behavior is held by the real-Git doctest.

There is no schema or data migration, feature flag, background job, or deployment transition. The feature is a best-effort addition to the existing not-found response: old clients keep today's behavior, and new clients follow only a validated move. It ships as one bug fix after the boxholder approves implementation and later chooses to land the worktree.
