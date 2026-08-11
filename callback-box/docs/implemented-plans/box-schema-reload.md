---
title: "Box-local schema reload — design & implementation plan"
status: implemented
workstream: unknown
issues: []
---
# Box-local schema reload — design & implementation plan

## TL;DR

A box agent edits a box-local schema (`config/schemas/*.ts`) on the box, but the
long-lived hosted `cb serve` keeps serving the *stale* card type until it restarts,
because Node permanently caches dynamic `import()` by URL and we cache on top with
`boxSchemaCache`. Fix = **content-hash-gated cache-bust** so the live server picks up
edits with zero downtime, plus a **daily at-rest process recycle** that reclaims the
small unavoidable leak. A shared **wait-for-quiet** check makes both that recycle *and*
auto-deploys make a bounded, best-effort attempt not to kill an active chat turn. Plus a cluster of correctness fixes the reload path needs
regardless of mechanism (watcher must start at box registration, single-flight
rebuild, keep-last-good, template unregister lifecycle), and a docs correction so box
agents stop cargo-culting `cb init` as a server-cache fix.

## What's actually true (mechanics)

- Box-local schemas are `config/schemas/*.ts` files that default-export a
  `cardSchema()` (optionally also a named `template`). Loaded by
  `loadBoxSchemas(boxRoot)` in `src/schemas/registry.ts`, which dynamically
  `import()`s the `.ts` directly. Module-resolution hooks (`ensureResolveHooks`,
  registry.ts ~136) rewrite known bare deps (`callback-box/cards`, `zod`, `yaml`) to
  resolve from callback-box's tree; tsx strips the TS types. **No compiled artifact,
  nothing gitignored.** `config/schemas/package.json` (`{"type":"module"}`) is
  committed.
- Two caches stack: Node's permanent per-URL ESM `import()` cache, and a per-`boxRoot`
  `boxSchemaCache: Map` over the readdir+import result (registry.ts ~202).
- Result: a **long-lived** process never sees on-disk schema changes; a **fresh** `cb`
  subprocess always loads them fresh.

## Where the friction actually bites

`loadBoxSchemas` is reached (mostly via `createCardSchemaMap`/`getSearchableTypes`)
from ~24 sites. Classified by process lifetime:

| Process | Lifetime | Stale? | Notes |
|---|---|---|---|
| `cb serve` (Fastify web app) | **long-lived** | ❌ until restart | card render (`trpc/routers/card.ts` ~108), webapp validation, search, file/todo views. **The symptom surface.** |
| `cb scheduler start` (daemon) | long-lived | ❌ but narrow | parses scheduled-script cards in-process (`tick.ts` ~101) to pick due scripts, then runs them as **fresh `sh -c` subprocesses** (`exec-with-timeout.ts` ~75). Only matters if a box *overrides* the built-in `scheduled-script` type (exotic — see Residuals). |
| `cb validate --hook` (PostToolUse) | **fresh** | ✅ | the agent's own write-validation already sees edits. |
| `cb init`, `cb create`, `cb tick`, `cb validate`, `cb wakeup` + connectors | **fresh** | ✅ | every one-shot CLI / spawned wakeup sees edits. |

So the actor is the **agent**, editing on the box, and the only meaningful stale
consumer is the long-lived **`cb serve`**. (The agent's `cb init` habit never touched
the server cache — `cb init` is a fresh process. What it *does* do is real but
unrelated: regenerate agent-facing rules/docs — see "cb init split" below.)

## New file vs. edit — drives the leak story

- **Adding a new schema file** (new card type, new URL): only `boxSchemaCache` is
  stale; Node's `import()` has never seen that URL. Invalidating the Map → re-readdir
  → first import → loads. **Zero leak.**
- **Editing an existing file** (same URL): the permanent `import()` cache returns the
  old module. Picking up the edit in-process requires a *different* URL (`?v=…`),
  which is the move that leaks (below).

## The leak, and why it can't be cheaply avoided in-process

Node/V8 does not reclaim loaded code in a long-lived process. We measured both
candidate in-process mechanisms on Node 22.22:

- **`import()` cache-bust** (`?v=<hash>`): leaks one compiled ES **module** (~tens of
  KB: a Zod graph + strings + the `validate` closure) per *distinct* edited content.
- **vm isolated loader** (`vm.SourceTextModule` + linker): we initially chose this
  believing it was GC-able, but a direct measurement
  (`v8.getHeapStatistics().number_of_native_contexts`, drop refs + `global.gc()`)
  showed **native contexts grow 1-per-reload and never recede** — a *heavier* leak
  than cache-bust, plus it breaks the current import surface (it would only bridge 3
  deps; today schemas may use relative/`node:*`/other imports via tsx) and must
  separately extract the `template` export. **vm is rejected.**

Genuinely leak-free options are only: restart the process, or move schema-dependent
work into a killable worker (but `CardSchema` carries a `validate` function + live Zod
objects that can't cross a worker boundary, so that means delegating *operations* and
returning serializable results — a large rearchitecture). Neither is cheap.

**Honest magnitude:** agent schema edits to a given box are occasional even when
agent-driven (add/iterate a card type, then it stabilizes) — order tens/month. A
cache-bust leak is therefore ~1 MB/month worst case. The decision below caps it far
tighter.

## Decision

**Cache-bust for the live editing loop + a daily at-rest process recycle as the
janitor.** Rationale (boxholder): an editing session is exactly when you *can't*
tolerate a restart, so the live path must be zero-downtime (cache-bust). The small
monotonic leak is then reclaimed by recycling `cb serve` once a day while it's at rest
— restart-as-scheduled-GC, never as the reload trigger, so it never interrupts. This
bounds the leak to ~a day's edits.

- **Dev:** the router already idle-restarts Fastify after ~5 min idle, so dev reclaims
  the leak for free. The daily recycle is **prod-only**.
- **Prod:** an external `systemctl restart callback-serve` works regardless of the
  unit's `Restart=on-failure` (`deploy/setup-server.sh` ~155) — **no unit change
  needed**. A daily systemd timer at a quiet hour, guarded to skip-and-retry if a
  request or chat turn is in flight.

## Implementation

### 1. Cache-bust loader (`src/schemas/registry.ts`)

- **State model (Codex #1 — the critical contract).** Two separate pieces of state:
  - the assembled `boxSchemaCache: Map<boxRoot, BoxSchemas>` (the snapshot consumers
    read), and
  - **persistent per-file bookkeeping** keyed by absolute path: `{ lastHash,
    importedUrl, lastGoodResult }`.
  `invalidateBoxSchemas(boxRoot)` deletes **only** the assembled `BoxSchemas` entry.
  It must **NOT** clear the per-file bookkeeping — that state is exactly what tells the
  next rebuild "this existing file's hash changed, import it as `?v=<newhash>`." If we
  cleared it, an edited file would look never-seen, re-import the *bare* `file:` URL,
  and Node returns the **stale** module (registry.ts ~238) — silently defeating the
  whole mechanism. (It would also make keep-last-good impossible.)
- In the rebuild (`loadBoxSchemasUncached`), per file: read source, compute a **content
  hash**, compare to stored `lastHash`. Import `pathToFileURL(file).href` for a
  never-seen file, `…?v=<hash>` when the hash changed, or reuse the prior result when
  unchanged. New + unchanged files never bust → no leak; only changed content mints a
  new URL. Update the per-file record after a successful load.
- **Hot path stays cheap:** the 24 callers still hit `boxSchemaCache` and never stat;
  hashing runs only inside the rebuild, i.e. only after an invalidation.

### 2. Single-flight + keep-last-good (Codex #4)

- **Single-flight:** store an in-flight `Promise<BoxSchemas>` per boxRoot so N
  concurrent callers after an invalidation share one rebuild instead of racing N
  imports.
- **Keep-last-good (Codex #5 — cover all per-file failures, not just throws):** today a
  per-file load can fail two ways — the import *throws* (registry.ts ~251) **or** it
  imports fine but exports no valid default schema (registry.ts ~241); both currently
  warn and drop the type, so a broken mid-edit save could blank a working type. Treat
  **any** per-file load/validation failure as "reuse this file's `lastGoodResult`."
  Only a genuinely **deleted** file drops its type (and clears its bookkeeping).
- **Atomic swap:** build the complete new `BoxSchemas` and only then `set()` it;
  in-flight callers finish on their snapshot (`createCardSchemaMap` already returns a
  fresh Map per call).

### 3. Watcher must start at box registration (Codex #3)

- `ensureBoxWatcher` is currently called **only** from `events.subscribe`
  (`trpc/routers/events.ts` ~55), so a server with no active UI subscription would
  never invalidate. Start schema-dir watching at **box registration**
  (`server-box-scope.ts`, alongside the existing `closeBoxWatcher` teardown), not on
  subscription.
- Invalidate `boxSchemaCache` (call #1's `invalidateBoxSchemas`) on `config/schemas/`
  changes. Inject the invalidator into the watcher to avoid a registry→watcher import
  cycle.
- **Mark-dirty-immediately, debounce only the rebuild (Codex #6).** To shrink the
  window where callers see the old cache between the disk edit and the rebuild: on the
  raw watcher event, *immediately* drop the assembled cache (mark the root dirty); use
  the debounce + chokidar **`awaitWriteFinish`** (the current watcher,
  box-file-watcher.ts ~36, has neither) only to gate the *rebuild* so a temp-write+rename
  burst never imports a half-written file. A caller arriving in the dirty window simply
  triggers the (single-flight) rebuild itself.
- Decide whether to extend the existing watcher or add a small dedicated schema watcher
  — leaning dedicated, to keep the high-churn-tuned UI watcher untouched.

### 4. Template lifecycle — must be box-scoped (Codex #2, #6)

- `registerTemplate` is a blind `Map.set` by name into **one global registry shared by
  every box the server hosts** (`templates-registry.ts` ~38/46; the server serves
  multiple boxes in one process, server.ts ~109), with no owner metadata and no
  unregister. So removed/renamed templates linger forever and show up in `cb create`
  (`create.ts` ~92) — and a naive "unregister the names box X registered" would clobber
  box Y's same-named template or fail to restore a built-in that a box template shadowed.
  This is a **pre-existing multi-box hazard** the reload path must not worsen.
- Fix with **ownership, not a flat `unregisterTemplate(name)`**: tag each registration
  with its owner (boxRoot, or `"builtin"`) — e.g. registry keyed by `(owner, name)` with
  scoped lookup, or a per-name owner stack so unregistering a box template restores the
  shadowed built-in. On reload, replace exactly *that box's* template set. Built-ins are
  registered once at import and never touched by box reloads.
- Scope assessment: this touches `templates-registry.ts` and its lookup callers; keep it
  minimal but correct — a shared global without ownership is the actual root bug.

### 5. Restart-when-quiet — shared by the daily recycle AND deploys (Codex #4)

Both the leak-reclaim recycle **and** the auto-deploy restart should avoid killing
active work — and the deploy restarts **both** `callback-serve` (where chat turns run)
and `callback-scheduler` (which runs scripts/procedures, incl. long `cb wakeup`/agent
runs, as `sh -c` children; default systemd `control-group` kill takes the children with
it). So "active work" is broader than chat turns. Build the avoidance **once** and use
it in both the recycle and the deploy. Stay best-effort: a deploy must not block
forever.

**5a. Reuse the existing on-disk activity check — don't build a new endpoint.** The
codebase already has a precise, file-based "is the box at rest?" primitive:
`findBusyBlockers(boxRoot, running)` (`tick-helpers.ts` ~73), which `cb tick` uses to
defer its housekeeping until nothing is in flight. It reports:
- **running procedures** (`loadRunningProcedures`),
- **active chat turns** via the **chat-active lock held for the entire duration of every
  SDK run** (`chat-session.ts` ~164; `loadActiveChats` in `schedule-state.ts` ~294) —
  this lock wraps the run regardless of entry path (HTTP send, queued `drainQueue`,
  self-note, schedule-fired), so it's the on-disk mirror of `ChatSession.isBusy()`
  (`chat-session.ts` ~398) and strictly better than the HTTP-only turn-pin Codex flagged,
- **running scripts**.

Because it reads **on-disk locks**, it is cross-process, cross-box, and queryable
**server-side** — which dissolves Codex pass-3 #1 (no in-memory server-wide aggregator,
no busy field on a live endpoint) and its race concern (we don't poll the very process
we're about to restart; we read lock state on disk). Expose it as a small read-only CLI,
e.g. `cb activity` / `cb at-rest`, that runs the blocker check across all configured
boxes and exits 0 (at rest) / non-zero with the blocker list.
- **One thing to confirm in implementation:** procedures and chat-active locks are
  on-disk; verify in-flight scheduled *scripts* are too (the scheduler's in-memory
  `running` set isn't visible cross-process). If a bare script isn't lock-filed, either
  add a per-running-script lock or rely on the procedure-run/chat locks that already
  cover the long agent work. (This squarely addresses Codex pass-3 #2.)

**5b. Shared, server-side, bounded `wait-for-quiet`.** A small poller that runs
**on the prod host** (Codex pass-3 #3): query `cb activity`, wait up to a cap (~2–5 min)
for at-rest, then proceed regardless. Used by:

- **Deploys (the ask).** In `deploy/deploy.sh`, the restart runs over
  `ssh root@SERVER systemctl restart callback-serve callback-scheduler` (~188) and the
  post-restart `/healthz` verify already runs **server-side** via `ssh … bash -s` using
  localhost + `/home/callback/.env` (~192). Add a **matching server-side heredoc that
  runs `cb activity` before** the restart — so it sees prod's lock state, not the
  deployer's localhost. Because the check covers scripts/procedures *and* chats, it
  protects scheduler work too — no need to split or special-case `callback-scheduler`.
- **Daily recycle.** A systemd timer (`callback-serve-recycle.timer` + `.service`,
  provisioned in `deploy/setup-server.sh`) that runs the same `cb activity` wait then
  `systemctl restart callback-serve`. Reclaims the cache-bust leak (~1 MB/month → ~a
  day's worth).

**Cost, documented not hidden:** still best-effort — work that outlasts the wait cap, or
that starts in the gap between the last poll and the restart, can be interrupted
(`server.ts` ~155 force-closes connections; chat registries/turn buffers are in memory,
chat.ts ~213 / chat-turn-buffer.ts ~119; "tabs catch up" only *after* durable transcript
writes). Acceptable given the cap, the quiet hour, and resumable turns. A *graceful drain
on SIGTERM* (let in-flight work finish before exit) is a larger future hardening, out of
scope. Dev is unaffected (router idle-restart already reclaims the leak; dev doesn't
auto-deploy).

### 6. Manual reload escape hatch (optional, cheap)

- An authenticated admin endpoint (we already have `registerBoxAdminRoutes` with an
  owner check) that calls `invalidateBoxSchemas(boxRoot)` — for "pick it up right now"
  without waiting on the watcher. No auto-restart.

### 7. Docs / cargo-cult correction

- `src/core/box-templates.ts` (the `config/schemas/CLAUDE.md` template, "After Adding
  or Modifying Schemas"): replace "a running dev server needs a restart" with the real
  split — the server now **hot-reloads** box schemas on save; `cb init` is for
  regenerating **agent-facing** rules/docs, not server registration.
- Mirror in `docs/adding-schemas.md` if it implies `cb init` re-registers.

## The "cb init split" (corrected per Codex #3)

Three *distinct* things, not two — conflating them was an error:
1. **Runtime registry** (render/validate/search in `cb serve`) — fixed by this plan's
   hot-reload.
2. **Agent-facing derived disk artifacts**, regenerated by `cb init` from the schema's
   `instructions`: `.claude/rules/card-<type>.md` (`init-rules.ts` ~65) and
   `docs/generated/card-<type>.md` + the agent-guide card list (`generate-docs.ts`
   ~415). These are committed box files read by the **agent**, not the server; no
   runtime reload regenerates them — `cb init` still does and is still needed for them.
3. **`cb create` templates are NOT disk artifacts** — they're *in-memory* registrations
   created as a side effect of `loadBoxSchemas`. `cb init` does not "generate" them to
   disk. And there's a **pre-existing ordering bug**: `cb create` calls
   `getTemplate`/`getDefaultTemplate` *before* it ever calls `loadBoxSchemas(boxRoot)`
   (`create.ts` ~92), so a fresh `cb create` may not have registered box-local templates
   yet. Fix: load box schemas *before* listing/describing/choosing templates in
   `cb create`. (Related but separable from the server hot-reload; bundle it here since
   we're touching the template registry anyway.)

## Residuals (documented, out of scope)

- **Scheduler override of `scheduled-script`** (Codex #5): the scheduler daemon parses
  scheduled-script cards in-process and box schemas *can* override built-ins by type
  (registry.ts ~296/createCardSchemaMap merge). A box overriding the built-in
  `scheduled-script` type would see a stale override in the long-lived scheduler until
  its own restart. Exotic; document rather than wire the scheduler into invalidation.
- **Cross-process leak bound** rests on the daily recycle; if the recycle is disabled,
  the cache-bust leak reverts to ~1 MB/month — still small, but note it.
- **Template *lookup* is process-global** (Codex diff-review #3): this change owner-scopes
  template *registration* (a box reload no longer clobbers another box's same-named
  template, and dropped box templates restore the shadowed built-in), but
  `getTemplate`/`getAllTemplates` still resolve globally with no `boxRoot`. Pre-existing,
  and mostly moot because the heavy consumers (`cb create`, `cb init`) are fresh
  single-box processes that only ever load one box's templates. It would only bite a
  long-lived multi-box server/scheduler doing a by-name template lookup when two boxes
  define the *same* template name. Fixing it means threading `boxRoot` through the lookup
  API and all callers — a separate change, deferred.
- **Watcher uses `awaitWriteFinish`, not "mark dirty immediately"** (Codex diff-review #4):
  a deliberate choice — it never reads a half-written file, the ~150ms extra staleness is
  negligible for a human/agent edit loop, and the loader's `dirtyEpoch` makes any
  rebuild/event overlap correct regardless. Kept as-is.

## Touch list

- `src/schemas/registry.ts` — content-hash gated bust; persistent per-file
  hash/url/last-good bookkeeping; `invalidateBoxSchemas` (drops assembled cache only);
  single-flight promise; keep-last-good for all per-file failure modes.
- `src/schemas/templates-registry.ts` — owner-scoped registration (`(owner, name)` /
  owner stack) + per-box replace-on-reload; not a flat `unregisterTemplate`.
- `src/core/commands/create.ts` — load box schemas **before** template lookup (#3
  ordering bug).
- `src/core/box-file-watcher.ts` (or a new `schema-watcher.ts`) — mark-dirty-immediately
  + debounced rebuild with `awaitWriteFinish`, invalidate on `config/schemas/` changes.
- `src/webapp/server-box-scope.ts` — start schema watching at box registration.
- `src/webapp/routes/admin.ts` — manual reload endpoint (optional).
- new `cb activity`/`cb at-rest` CLI — wraps `findBusyBlockers` (tick-helpers.ts) across
  all configured boxes; exit 0 at-rest / non-zero with blockers. Confirm in-flight
  scheduled scripts are on-disk-detectable (add a script lock if not).
- `deploy/deploy.sh` — server-side heredoc running bounded `cb activity` wait-for-quiet
  *before* the remote `systemctl restart callback-serve callback-scheduler` (best-effort,
  capped). Covers chat + scripts + procedures, so no scheduler special-casing.
- `deploy/setup-server.sh` — quiet-hour recycle timer + `.service` reusing the same
  `cb activity` wait.
- `src/core/box-templates.ts` + `docs/adding-schemas.md` — cargo-cult correction.
- Doctests / tests:
  - **`?v=hash` regression (make-or-break, Codex "Checked OK"):** a `config/schemas/X.ts`
    imported as `X.ts?v=<hash>` still resolves `callback-box/cards`, `zod`, `yaml` — run
    in **both** prod-bundle and `--import tsx` dev modes.
  - new file appears without restart; edit appears (content-hash bust); unchanged file
    not re-imported.
  - keep-last-good on a throwing save **and** on a no-valid-default save; deleted file
    drops.
  - concurrent callers share one rebuild (single-flight); hot path doesn't stat.
  - template rename/removal de-registers for the right box only (multi-box isolation).

## Review trail

- Symptom/call-site map, cb-init lifecycle, and template-registry semantics verified by
  source reads.
- Codex pass 1 (2026-06-28): #1 (vm not leak-free), #2 (vm import surface), #3 (watcher
  start), #4 (single-flight/keep-last-good), #6 (template unregister), #7 (plan
  self-contradiction) accepted; #5 (scheduler) → residual. vm collectability disproven
  empirically (native-context growth); cache-bust chosen as the lightest in-process
  leak.
- Codex pass 2 (2026-06-28, on the rewritten plan): verified `?v=hash` viable against
  tsx source. Found + folded in: #1 invalidation state contract (drop assembled cache
  only, persist per-file state) — *critical, the core was self-defeating*; #2 template
  registry needs owner-scoping (multi-box global Map); #3 templates aren't disk
  artifacts + `cb create` ordering bug; #4 recycle needs honest user-impact, chosen
  quiet-hour best-effort; #5 keep-last-good covers no-valid-default too; #6
  mark-dirty-immediately. Outstanding pre-implementation check: the `?v=hash` dual-mode
  regression test.
- Codex pass 3 (2026-06-28, on Section 5): no-go as written. Found + folded in: #1 wrong
  busy primitive + no server-wide aggregator; #2 scheduler restart kills active
  scripts/procedures; #3 deploy wait must run server-side. **Resolution (better than
  Codex's suggested aggregator):** reuse the existing on-disk `findBusyBlockers`
  (procedures + chat-active lock + scripts) via a `cb activity` CLI, queried server-side
  — one check protects both services, no new endpoint, no live-process polling race.
  Section 5 rewritten accordingly.
- `?v=hash` dual-mode spike PASSED (2026-06-28): in **both** prod (plain `node` +
  native type-stripping — prod `cb serve` runs in the bundle without tsx) and dev
  (`--import tsx`): a bare re-import of an edited URL is stale/cached (same module),
  while `?v=<contenthash>` returns fresh content as a distinct module with
  `callback-box/cards`/`zod`/`yaml` resolved and Zod identity intact; identical content
  reuses the same module (no leak on no-op). Make-or-break retired.
