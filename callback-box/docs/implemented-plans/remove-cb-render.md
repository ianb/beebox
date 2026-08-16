---
title: "Remove `cb render` and the SSR machinery"
status: implemented
workstream: unknown
issues: []
---
# Remove `cb render` and the SSR machinery

`cb render` renders a frontend page to HTML with React SSR. It does not work:
`renderToString` returns an empty `<body>` because the app is React-Query and
Suspense driven. `bin/browse` covers the real need better. This plan removes the
command, the SSR entry graph, and the SSR state-injection hook, and rewires the
five live surfaces that consume their XState machines through that hook.

The decision to remove is settled — see
[cb-render-vs-bin-browse](../../../issues/closed/decisions/2026-07-07-cb-render-vs-bin-browse.md).
This plan is about *how* to remove it without a silent regression in chat, voice,
transcription, or speech playback.

## Stated preferences this plan trades against

- **`docs/engineering-principles.md`** — the plan traces mainly to these:
  - *Types are structure.* The removal deletes a generic wrapper whose only
    remaining job was to widen `ActorOptions` past what the checker can express.
    Three `eslint-disable` comments exist to hold that widening together
    (`useSSRMachine.ts:33,36,39`). Deleting the wrapper deletes the casts.
  - *Never resilient to the impossible.* `suppressHydrationWarning` guards
    against a hydration mismatch. Nothing hydrates. It is a fallback for a state
    that cannot occur, and it masks real mismatches if one ever could.
  - *Right-sized defensiveness.* The `typeof window === "undefined"` guards are
    the opposite case: cheap, and they defend a boundary (module-scope browser
    globals under any non-browser evaluation, including doctests run under tsx).
    They stay.
- **`CLAUDE.md`** — *"Read before writing"* (`CLAUDE.md:101`); *"Leave the repo
  clean when committing"*; the guides table (`CLAUDE.md:169`) and source layout
  (`CLAUDE.md:73`) both name `cb render` and must be updated in the same change.
- **`code-style.md`** — the lint-suppression section: *"Never weaken a rule to
  make code pass. Fix the code, or raise it with the boxholder first."* This plan
  removes a lint rule (the `useMachine` ban). That was raised with the boxholder
  and approved before this plan was written — see Track 3.
- **Precedent:** `cb view test` (`src/cli/commands/view.ts:352`) is the surviving
  "run React outside the webapp" path. It keeps `react-dom/server` and `cheerio`
  alive, so this removal drops no dependency.

## What already exists

Everything in this plan already exists; the work is subtraction. Inventory with
citations:

**The command and its entry graph (deleted):**
- `src/cli/commands/render.ts` (95 lines) — `src/cli/commands/render.ts:23`:
  *"export const renderCommand = new Command("render")"*. It builds the child
  script path at `render.ts:51` and spawns the tsx child at `render.ts:82`.
- `src/cli/commands/index.ts:44` — *"export { renderCommand } from
  "./render.js";"*. This is a **barrel**, and it is where `src/cli/index.ts:52`
  gets the symbol; `src/cli/index.ts:52` is an import *from the barrel*, not
  from `commands/render.ts`. Both must change. (The barrel itself contradicts
  `code-style.md`'s no-barrels rule; that is pre-existing and out of scope here.)
- `src/cli/index.ts:127` — *"program.addCommand(renderCommand);"*.
- `src/frontend/src/ssr/` — **9 files, 935 lines**: `render.tsx` (344),
  `state-registry.ts` (180), `state-registry-machines.ts` (154),
  `state-registry-routes.ts` (128), `setup.ts` (43), `noop-trpc.ts` (25),
  `css-loader.mjs` (27), `state-registry-types.ts` (27),
  `register-loader.mjs` (7).
- **One consumer outside `src/ssr/` exists:**
  `test/frontend/state-registry-routes.doctest.md:28` —
  *"import { routeConfigs } from
  "../../src/frontend/src/ssr/state-registry-routes";"*. It is deleted with the
  registry. Note that **neither `pnpm typecheck` nor ESLint sees code embedded
  in a doctest markdown file**, so a missed doctest import surfaces only under
  `pnpm test`. Grep for each deleted module name over `test/` is therefore part
  of the deletion, not an afterthought.
- `docs/ssr-render-testing.md` — the command's reference doc, linked from
  `CLAUDE.md:169`.

**The state-injection hook (deleted, and this is the delicate part):**
- `src/frontend/src/hooks/useSSRMachine.ts` (42 lines). Its whole body:
  `useSSRMachine.ts:32-41` reads `SSRStateContext`, looks up
  `ssrState[machine.id]`, and calls `useMachine(machine, { ...options, snapshot:
  ssrSnapshot ?? options?.snapshot })`.
- The only `SSRStateContext.Provider` in the codebase is `ssr/render.tsx:328`.
  `src/frontend/src/main.tsx:20` mounts the app with `ReactDOM.createRoot`, not
  `hydrateRoot`, and no provider wraps the live tree. **Therefore in every
  running surface `ssrState` is the context default `{}` (`useSSRMachine.ts:22`),
  `ssrSnapshot` is `undefined`, and the hook is exactly
  `useMachine(machine, options)`.** It returns the same 3-tuple `[snapshot, send,
  actor]` (`useSSRMachine.ts:31`) that `useMachine` returns. The rewiring is
  therefore behavior-preserving by construction, not by inspection.

**The five live call sites (rewired):**

| File:line | Machine | Options passed |
|---|---|---|
| `components/chat/InteractiveChat.tsx:140` | `chatMachine` | `{ input: { sessionInput, contextDir } }` |
| `components/chat/InteractiveChat-voice.ts:219` | `composerMachine` | `{ input: { narration, muted } }` |
| `hooks/useRealtimeTranscription.ts:225` | `realtimeTranscriptionMachine` | none |
| `hooks/useSpeechPlayback.ts:54` | `speechPlaybackMachine` | `{ input }` |
| `components/admin/ClaudeCodeSection.tsx:12` | `claudeAuthMachine` | none |

**The lint rule that exists only for the hook:**
- `src/frontend/eslint.config.mjs:20-24` — `XSTATE_USE_MACHINE`, whose message is
  *"Import `useSSRMachine` from src/hooks/useSSRMachine.ts instead of
  `useMachine` from @xstate/react — the wrapper hydrates the machine snapshot
  from SSRStateContext so SSR is safe; a bare useMachine only works
  client-side."*
- The constant is referenced in **three** blocks, not two: the base block
  (`eslint.config.mjs:126`, with the `ignores` at `:120`), the `src/ssr/**`
  exception (`:129-135`), the `useSSRMachine.ts` exception (`:137-148`) — **and
  the outside-Vite block at `eslint.config.mjs:157`**: *"{ paths:
  [XSTATE_USE_MACHINE], patterns: [...BOUNDARY_PATTERNS] }"*. That fourth
  reference is easy to miss and deleting the constant without it is a
  `ReferenceError` at config load.

**SSR accommodations elsewhere (each individually judged — see Track 4):**
- `components/ui/FriendlyDate.tsx:28` — `suppressHydrationWarning`, explained at
  `FriendlyDate.tsx:4`: *"`suppressHydrationWarning` because the server (SSR `cb
  render`) formats in its own zone"*.
- `components/AgentViewRenderer.tsx:95`, `components/DebugLog.tsx:105`,
  `components/chat/screenshot-relay.ts:105,169` — `typeof window` guards from the
  crash fix ([cb-render-ssr-window-undefined](../../../issues/closed/bugs/2026-07-07-cb-render-ssr-window-undefined.md)).
- `components/Markdown.tsx:55` and `lib/markdoc-parse.ts:18` — `import-x` lint
  exceptions justified as *"named import fails under Node ESM SSR"*. **`cb
  render` is their only non-Vite consumer.** Verified: nothing under `test/`
  imports either module; the only importer of `markdoc-parse` is `Markdown.tsx`
  (`Markdown.tsx:50`); the view-widgets Node entry
  (`components/view-widgets/node-entry.tsx`) does not pull either. So the
  constraint they document goes away with SSR. (The identical pattern in the
  backend's `markdoc-config.ts` / `body-refs.ts` runs under Node and keeps it.)
- `components/chat/InteractiveChat-attachments.ts:72` — the `useSyncExternalStore`
  third argument, commented *"required for SSR (`cb render` …)"*.

**Dependencies:** none are dropped. `cheerio` (`package.json:113`) and
`react-dom/server` are both still used by `src/cli/commands/view.ts:33-34,106`
— the surviving "run React outside the webapp" path is **`cb view test`**
(`src/cli/commands/view.ts:352`, registered at `:384-389`). There is no
`cb view render`. `cb view test` renders *compiled agent views* through the
Node view host (`view.ts:176-177`: *"const { NodeViewHostProvider } = await
import("callback-box/view-widgets");"*), **not** through the app's component
tree — so it does not exercise `AgentViewRenderer`, `DebugLog`,
`screenshot-relay`, or the frontend `Markdown`. Any claim that those modules
still have a non-browser consumer must not lean on it.

**Test coverage that exists:** `test/frontend/chat-machine-finalize.doctest.md`,
`composer-machine.doctest.md`, `speech-playback-machine.doctest.md` and siblings
exercise the machines directly, not through React. They neither cover nor are
affected by the hook swap. No doctest invokes `cb render`; one doctest does
import the SSR route registry (`state-registry-routes.doctest.md:28`, deleted
with it). This is stated plainly because it means the hook rewiring has **no
automated regression net**; see Rollout shape.

## Prior art (external)

Searched and found nothing that changes the plan; recording what was searched so
the next reader does not repeat it.

- **`renderToString` and Suspense.** React's own docs state that
  `renderToString` does not wait for data and does not support streaming — see
  [renderToString: caveats](https://react.dev/reference/react-dom/server/renderToString).
  This corroborates the issue's diagnosis rather than adding to it. Recorded
  because it is the load-bearing reason this is a removal and not a fix: making
  `cb render` work means `renderToPipeableStream`, a real project.
- **`suppressHydrationWarning` without hydration.** No external source suggests
  it does anything in a `createRoot`-only app; the React docs scope it to
  hydration mismatch. No prior art found describing a downside to removing it in
  a client-only app.
- **XState `useMachine` snapshot option.** No prior art needed — the removal
  deletes an option rather than adopting one.

No external search applies to the rest: this is subtraction of project-local
code, with no third-party behavior in play.

## Tracks / scope

Ordered by implementation dependency. **Track 2 lands first**, then Tracks 1+3
together, then Track 4. Deleting the SSR graph first leaves `useSSRMachine` a
harmless no-op wrapper and keeps every intermediate commit typechecking; the
reverse order (an earlier draft of this plan) knowingly produced a commit where
`ssr/render.tsx:29` imported a deleted hook, which violates `CLAUDE.md`'s
*"Leave the repo clean when committing"*. Tracks 1 and 3 must be one commit —
the call sites cannot import `useMachine` while the ban is live, and the ban
cannot be deleted while the call sites use the wrapper.

### Track 1 — Rewire the five machine call sites

**What.** Replace `useSSRMachine(machine, options)` with
`useMachine(machine, options)` from `@xstate/react` at the five sites listed in
*What already exists*, and delete `src/frontend/src/hooks/useSSRMachine.ts`.

**Why this needs to change.** The hook cannot survive the removal of
`SSRStateContext`, and with no SSR it is a no-op indirection whose only remaining
content is three `eslint-disable` comments for casts that exist to satisfy the
wrapper's own generics (`useSSRMachine.ts:33,36,39`).

**Direction.** Mechanical, one edit per file: swap the import, swap the call.
Options objects pass through unchanged. No call site reads a third tuple element
it did not read before; `InteractiveChat-voice.ts:219` already destructures all
three (`composerSnapshot, composerSend, composerActor`) and `useMachine` returns
the same three.

**One typing difference to expect.** The wrapper's signature
(`useSSRMachine.ts:28-31`) takes `options?: ActorOptions<TMachine>`, which is
laxer than `useMachine`'s — `useMachine` requires an `input` when the machine
declares one. All three input-bearing call sites already pass a valid `input`
(table above) and the other two machines take none, so no call site should
break. If one does, that is a **pre-existing latent type hole the wrapper was
hiding**, and the fix is to supply the real input, never to re-widen.

**First implementation chunk.** All five swaps plus the hook deletion, in one
commit with the lint-rule change from Track 3.

**Vocabulary lock-ins.** None — this removes a project-local name
(`useSSRMachine`, `SSRStateContext`, `SSRStateMap`) and returns to the library's.

### Track 2 — Delete the command and the SSR entry graph

**What.** Delete `src/cli/commands/render.ts`, its barrel export
(`src/cli/commands/index.ts:44`), its import and registration in
`src/cli/index.ts` (`:52`, `:127`), all of `src/frontend/src/ssr/`,
`test/frontend/state-registry-routes.doctest.md`, and
`docs/ssr-render-testing.md`.

**Why this needs to change.** The command produces an empty `<body>`, so it is a
tool that reports success while telling the user nothing. Keeping it costs 823
lines of code plus a documented capability that does not work — a trap for the
next agent that reads `docs/ssr-render-testing.md` and believes it.

**Direction.** Straight deletion. The one consumer outside `src/ssr/` is the
route-registry doctest, deleted with it. Grep every deleted module basename over
`src/`, `test/`, and `docs/` before committing — `test/` in particular, because
neither typecheck nor lint reads doctest code blocks.

**Vocabulary lock-ins.** None.

**First implementation chunk.** The whole track; it is one commit, and it lands
**first**. After it, `useSSRMachine` still compiles and still behaves identically
(its context provider is gone, but the context default was already what every
browser render saw), so the tree is valid at this commit.

### Track 3 — Remove the `useMachine` lint ban

**What.** Delete the `XSTATE_USE_MACHINE` constant (`eslint.config.mjs:20-24`)
and **all four** of its references:

1. the base block's `paths` (`eslint.config.mjs:126`) — the block survives,
   carrying `{ patterns: [...BOUNDARY_PATTERNS, SHARED_ALIAS_PATTERN] }`;
2. the `ignores` entry at `:120` (it lists `src/ssr/**` and
   `src/hooks/useSSRMachine.ts`, both deleted);
3. the `src/ssr/**` block (`:129-135`) and the `useSSRMachine.ts` block
   (`:137-148`) — **deleted entirely**, since both files are gone;
4. the outside-Vite block at `:157` — the block **survives** and must become
   `{ patterns: [...BOUNDARY_PATTERNS] }`. It deliberately omits
   `SHARED_ALIAS_PATTERN` (those files import `src/shared/` by raw relative
   path); only the `paths` array goes.

**Why this needs to change.** The ban's stated justification is SSR safety
(quoted in *What already exists*). With no SSR, the rule forbids the only correct
way to use XState in this codebase and has no alternative to point at.

**Direction.** As above. The boxholder approved this removal explicitly before
this plan was written; per `code-style.md` a lint rule is not weakened
unilaterally, and this is recorded here as the audit trail.

**Care point (this is the plan's one silent failure mode).**
`eslint.config.mjs:113-115` warns: *"no-restricted-imports does NOT merge across
flat configs (last match wins), so useMachine + the boundary patterns are
declared together."* It is **not** true that every file ends up matched by
exactly one block: the files listed in `OUTSIDE_VITE_SHARED_RAW` (e.g.
`src/lib/view-url.ts`) match both the base block and the `:151` block, and the
later one wins *by design* — that is how they escape `SHARED_ALIAS_PATTERN`.
Getting item 4 above wrong therefore has two distinct bad outcomes, neither of
which shows a symptom in normal use: dropping the whole block's `rules` entry
would silently un-ban backend imports for those files, and deleting the constant
while leaving the reference is a hard config-load `ReferenceError`.

Verification is not "lint passes" — lint passing proves nothing about a ban that
stopped applying. The check is `eslint --print-config` on one file from each
class, comparing the resolved `@typescript-eslint/no-restricted-imports` value
before and after (see Rollout shape).

**Vocabulary lock-ins.** None.

**First implementation chunk.** Combined with Track 1's commit.

### Track 4 — Prune SSR accommodations and update prose

**What.** Two different things, deliberately separated:

**(a) Code that is removed** — `suppressHydrationWarning` at
`FriendlyDate.tsx:28` and the paragraph explaining it at `FriendlyDate.tsx:4-6`,
plus its description in `frontend.md:60`.

**Why (a).** Nothing hydrates (`main.tsx:20` is `createRoot`). The attribute can
only suppress a warning that cannot fire, and if the app ever did hydrate it
would hide a real mismatch. This traces to *never resilient to the impossible*.

**(b) Code that stays, with corrected comments** — the `typeof window` guards
(`AgentViewRenderer.tsx:95`, `DebugLog.tsx:105`, `screenshot-relay.ts:105,169`
and the other module-scope guards from the crash fix), and the
`useSyncExternalStore` third argument (`InteractiveChat-attachments.ts:72`,
`input-store.ts:116`).

**Why (b), stated honestly.** After this plan there is **no live non-browser
consumer of these modules** — `cb view test` renders compiled agent views through
the Node view host, not the app tree (see *What already exists*), and no doctest
imports them. So the justification is not "another caller still needs it"; it is
that a module-scope browser-global read is a landmine that costs one cheap
guard to defuse and cost a production incident when it went off
([cb-render-ssr-window-undefined](../../../issues/closed/bugs/2026-07-07-cb-render-ssr-window-undefined.md)),
and that any future non-browser evaluation (a component doctest, a static
emitter — `docs/plans/publish-pages.md` contemplates one) re-arms it. Comments
that currently say *"for `cb render`"* are rewritten to say that, not
re-attributed to another command. This traces to *right-sized defensiveness*:
the guard sits at a module-evaluation boundary, which is a real boundary
independent of who currently crosses it.

The `useSyncExternalStore` third argument is kept on different grounds: the
React types make `getServerSnapshot` optional, so it is not *required* as its
comment claims — but it is one repeated identifier, removing it is pure churn,
and its presence is correct if the store is ever read outside the browser. The
comment's "required for SSR" wording is corrected.

**(b2) Code that is removed as newly-unjustified** — the two `import-x/no-named-
as-default-member` suppressions at `Markdown.tsx:55` and `markdoc-parse.ts:18`,
with their destructure-off-default workaround, reverting to plain named imports
from `@markdoc/markdoc`. Their stated reason is Node's ESM loader, and after this
plan both modules are Vite-only (verified in *What already exists*). Vite already
tolerates the named form — the comments say so. This deletes two lint
suppressions, which `code-style.md` wants infrequent. Verified by typecheck,
lint, and the browser pass (a Markdown regression is immediately visible). The
identical pattern in the backend's `markdoc-config.ts` / `body-refs.ts` **stays**
— those genuinely run under Node.

**(c) Prose.** `CLAUDE.md:73` (source layout) and `:169` (guides table);
`frontend.md:60`; `docs/stack-decisions.md:20,182-183,786,788,931,941` — these
claim `cb render` is Done and describe SSR state injection as shipped
architecture, so they get rewritten to record that it was built and removed and
that `bin/browse` is the way to look at a page; `src/frontend/tsconfig.json:36-37`
and `eslint.config.mjs:59,67,74,82,112` (comments referring to `cb render` as a
tsx-with-frontend-tsconfig context — doctests still are, so the comments are
re-attributed, not deleted); `vite.config.ts:20`;
`src/cli/commands/view.ts:103` (*"mirrors `cb render`"*).

**Live plans and issues that cite `cb render` as an available capability** — these
mislead a reader who picks them up after the removal, so each is rewritten (not
deleted) to say the capability is gone and to point at `bin/browse`:
- `docs/plans/publish-pages.md:39,112` — cites it as a starting point for a
  static emitter. Note `:39` also says *"`cb view render` … is the closest
  existing precedent"*; that command does not exist either (it is `cb view
  test`), so fix that while there.
- `docs/plans/cli-restructure.md:51` — lists it in a command table.
- `docs/plans/docs-reorg.gap-analysis.md:57-59` — cites the SSR `window`-guard
  convention.
- `issues/exploration/2026-07-27-roku-tv-dashboard-display.md:63-64` and
  `issues/exploration/2026-07-27-echo-show-dashboard-display.md:126` — both
  propose building on `cb render`. Each needs a line saying the capability was
  removed, so the idea is re-costed rather than silently invalidated.

**Regenerated, not hand-edited:** `docs/doc-graph.md` (and
`docs/doc-graph.html`) still list the deleted doc. `doc-check --fix` explicitly
skips generated files (`src/dev/doc-check.ts:36`: *"const GENERATED_NO_SCAN =
new Set(["callback-box/docs/doc-graph.md", …])"*), so `pnpm doc-graph` and
`pnpm doc-graph-html` must be run as part of this chunk.

Historical records are **not** edited: `docs/implemented-plans/*`,
`docs/reports/user-stories-audit-2026-06-26.md`, and the closed issues under
`issues/closed/` describe what was true when they were written. They are only
touched if `doc-check` reports a broken link out of them (the deletion of
`docs/ssr-render-testing.md` may produce one).

**First implementation chunk.** One commit for (a)+(b)+(b2)+(c), landing last so
`doc-check` and `doc-graph` see the final file set.

## Subplans

None. No sub-question in this plan needs its own design step: every decision is
either mechanical (Tracks 1, 2) or already settled by the boxholder (Track 3).
The one genuinely lost capability — arbitrary-state exploration via
`--scenario`/`--machine`/`--mock` — was consciously given up in the tracking
issue rather than deferred to a future design.

## Failure modes

No critical gaps. The one failure mode with no test and no handling is called out
below the table with its rationale.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A `useMachine` swap changes machine startup because a call site relied on the injected `snapshot` option | No — machine doctests bypass React | N/A — the injected value is provably always `undefined` (`useSSRMachine.ts:22,32,34`; sole provider at `render.tsx:328`; `main.tsx:20` is `createRoot`) | N/A |
| A call site passed `options.snapshot` itself, which the wrapper's `??` fallback preserved | No | Preserved — the swap passes `options` through verbatim; and no call site passes `snapshot` (table in *What already exists*) | N/A |
| Chat/voice/transcription regress in a way types cannot catch (e.g. a wrong tuple element) | No automated test | Typecheck: all three tuple positions are typed identically by `useMachine` | Clear — a wrong element is a type error, not a runtime surprise |
| Removing the lint ban silently drops the import-boundary ban for the `OUTSIDE_VITE_SHARED_RAW` files (last-match-wins, `eslint.config.mjs:151-160`) | No | Verified by an `eslint --print-config` diff on one file of each class (Rollout shape) | **Silent if unprobed** — a dropped boundary ban shows no symptom, and lint still passes |
| Deleting `XSTATE_USE_MACHINE` while a fourth reference survives (`eslint.config.mjs:157`) | No | N/A | Clear and immediate — ESLint fails to load the config with a `ReferenceError` |
| A doctest imports a deleted `src/ssr/` module (`state-registry-routes.doctest.md:28`) | N/A | Deleted with the registry | **Invisible to typecheck and lint** — doctest code blocks are markdown; caught only by `pnpm test` |
| Reverting the Markdoc named-import workaround (Track 4 b2) breaks parsing under Vite | Indirectly — Markdown rendering is exercised across the app | Typecheck + the browser pass | Clear — Markdown renders or it does not |
| A `useMachine` call site now fails typecheck because the wrapper did not require `input` | N/A | Typecheck | Clear — compile error, and it means a real missing input |
| Deleting `docs/ssr-render-testing.md` breaks inbound doc links | Yes — `doc-check` runs in pre-commit | `doc-check --fix` | Clear — commit is blocked |
| Removing `suppressHydrationWarning` surfaces a hydration warning | No | Nothing hydrates | Clear if it ever fires — a console warning is the desired outcome, not a regression |
| A deleted `src/ssr/` module was imported by something grep missed | Yes — `pnpm typecheck` | Compile error | Clear |
| An agent later reads a stale doc and tries `cb render` | No | Track 4(c) removes every live pointer | Clear — `cb render` exits with commander's unknown-command error |

**The unprotected one:** the hook rewiring has no automated regression net,
because the affected surfaces (chat streaming, voice composer, realtime
transcription, speech playback) are React-integration paths that the doctest
tiers do not reach — the frontend doctests test machines, not components. This is
accepted rather than fixed, on the grounds that the swap is provably a no-op
(the injected snapshot is unreachable) and that building React-integration test
infrastructure for a deletion is disproportionate. It is covered instead by a
manual browser pass (Rollout shape). Writing that down is the point: if chat
misbehaves after this lands, this paragraph is the first place to look.

## Agent-flow / user-flow edge cases

This plan introduces no tag, field, card shape, or agent-authored value, so most
of the standard scenarios do not have a surface to occur on. Each is answered
rather than skipped:

- **Wrong tag / wrong field** — **N/A.** No vocabulary is added or changed.
- **Stale ref** — **N/A.** No refs are written or read.
- **Two agents touching the same card** — **N/A.** No card is touched.
- **Hand-edit drift** — **N/A.** No hand-editable format changes.
- **Fabricated free-form value** — **N/A.**
- **Validation error UX** — **ADDRESSED, in a lint sense.** After Track 3 an
  agent that imports `useMachine` gets no error (correct), and one that imports
  the deleted `useSSRMachine` gets a module-not-found compile error, which is
  clear. The bad outcome would be the reverse — a ban whose message names a file
  that no longer exists — which Track 3 prevents by deleting the rule with the
  file.
- **Partial migration / transition state** — **ADDRESSED.** There is no data
  transition, and after reordering there is no broken code state either: Track 2
  lands first (the SSR graph goes away while the wrapper stays valid and
  behaviourally unchanged), then Tracks 1+3 as one commit, then Track 4. **Every
  commit on the branch typechecks in isolation**, which is what
  `CLAUDE.md`'s clean-commit rule asks for.
- **Agent reaches for a removed capability** — **ADDRESSED.** An agent wanting
  to look at a page finds `bin/browse` via the `browse` skill; Track 4(c)
  rewrites the doc pointers that would otherwise send it to `cb render`.

## NOT in scope

- **Fixing SSR properly (streaming `renderToPipeableStream`).** The tracking
  issue judged this a real project against a capability nobody adopted.
- **Keeping arbitrary-state exploration in any form** (`--scenario`,
  `--machine`, `--mock`). Consciously given up, per the tracking issue's closing
  question. If it is ever wanted back it is a new design, not a restoration.
- **Removing the `typeof window` guards.** Explicitly kept — they are cheap, and
  frontend modules still evaluate outside a browser under tsx.
- **Removing the `useSyncExternalStore` third argument**
  (`InteractiveChat-attachments.ts:72`, `input-store.ts:116`). It is *optional*
  in the React types — the existing comment claiming otherwise is wrong and gets
  fixed — but passing the same getter is harmless and correct, so removing it is
  churn. Only the comment changes.
- **Removing the `import-x` suppressions in the backend's `markdoc-config.ts` /
  `body-refs.ts`.** Those modules genuinely run under Node's ESM loader; only
  the two frontend ones (Track 4 b2) lose their justification.
- **Fixing the `src/cli/commands/index.ts` barrel**, which contradicts
  `code-style.md`'s no-barrels rule. Pre-existing; this plan only removes one
  line from it.
- **Editing `docs/implemented-plans/*` or the user-stories audit report.**
  Historical records; see Track 4(c).
- **A custom lint rule banning module-scope browser globals.** Considered and
  declined in the crash-fix issue itself; removing SSR does not revive the case.
- **Touching `cb view test`** (`src/cli/commands/view.ts:352`). Different
  command, different purpose (agent-authored views), still works.

## Open design questions

None. The one question this work could have carried — whether to remove the
`useMachine` lint ban or keep a no-op wrapper to preserve it — was put to the
boxholder before planning and answered: remove the wrapper. It is recorded in
Track 3 rather than left open.

## Knowledge audits

**Skipped, with rationale.** `knowledge-audits.yaml` verifies that an agent can
recall an agent-facing convention. This plan adds no convention; it removes one
(`useSSRMachine`) and one command (`cb render`). An audit asserting an agent does
*not* know something is not a shape the audit system supports, and would be
unhelpful if it were — the desired end state is that `cb render` simply does not
appear in any doc an agent reads, which Track 4(c) achieves directly.

Existing audits were checked for references to `cb render` or SSR — grep over
`src/dev/knowledge-audits.yaml` finds none, so none need editing or re-running.

## Implementation order

1. **Chunk A — delete the command and SSR graph** (Track 2). Delete
   `src/cli/commands/render.ts`, its barrel export (`commands/index.ts:44`), the
   two `src/cli/index.ts` lines, `src/frontend/src/ssr/`,
   `test/frontend/state-registry-routes.doctest.md`, and
   `docs/ssr-render-testing.md`. Depends on nothing. Typechecks and tests green
   on its own.
2. **Chunk B — rewire + delete hook + delete lint ban** (Tracks 1 and 3
   together). Five call-site edits, delete `useSSRMachine.ts`, edit all four
   `XSTATE_USE_MACHINE` references in `eslint.config.mjs`. Depends on Chunk A
   only for tidiness (the two exception blocks it deletes name files Chunk A
   removed).
3. **Chunk C — accommodations and prose** (Track 4), including `pnpm doc-graph`
   and `pnpm doc-graph-html`. Depends on Chunk B, so `doc-check` and the graph
   regeneration see the final file set.
4. **Chunk D — verification** (Rollout shape). Not a commit unless it finds
   something.

## Rollout shape

**Test posture.** No new doctest is written, and this is a deliberate call rather
than a deferral. `docs/testing.md` scopes tests to substantial codepaths, not
coverage for its own sake; this change adds no codepath. The Failure-modes
table's "Test exists?" column is honest about the two rows with no test, and both
are covered by the checks below instead.

Done-when, as checkable assertions:

- `pnpm typecheck` passes (backend and frontend both) — catches any missed
  importer of a deleted module, and any tuple/generic mismatch at the five
  rewired sites.
- `pnpm lint` passes.
- **Boundary-ban probe — run it on one file of EACH class, not just an ordinary
  one.** Capture `pnpm exec eslint --print-config <file> | jq
  '.rules["@typescript-eslint/no-restricted-imports"]'` before and after the
  change for both `src/components/chat/InteractiveChat.tsx` (base block) and
  `src/lib/view-url.ts` (the `OUTSIDE_VITE_SHARED_RAW` last-match override).
  Expected diff in both: the `paths` array disappears, every `patterns` entry
  survives unchanged — and `view-url.ts` still correctly lacks
  `SHARED_ALIAS_PATTERN`. Probing only an ordinary frontend file does **not**
  test the last-match hazard, which is the whole risk.
- `pnpm test` passes with no new failures. This is the only check that sees
  doctest code, so it is the one that would catch a missed `src/ssr/` import.
- `pnpm --dir callback-box doc-check` passes (run `--fix` first for link repair),
  then `pnpm doc-graph` + `pnpm doc-graph-html` are regenerated and committed.
- `grep -rn "cb render" --exclude-dir=node_modules` returns only: this plan,
  `docs/implemented-plans/*`, `docs/reports/*`, and `issues/closed/*` — all
  historical. Any hit in `docs/plans/`, `issues/<open-category>/`, `src/`, or a
  root doc means Track 4(c) is incomplete. (`docs/doc-graph.md` must be
  regenerated before running this, or it produces a false hit.)
- **Manual browser pass via `bin/browse`** — the substitute for the missing
  regression net, covering each rewired machine at least once:
  - `/chat` — send a message, confirm streaming renders and completes
    (`chatMachine`). Markdown in the reply must render correctly — that also
    covers Track 4(b2).
  - `/chat` voice composer — mic start/stop, and the narration toggle
    (`composerMachine`, `realtimeTranscriptionMachine`).
  - **Speech playback needs its own step.** The narration toggle only sends
    `SET_NARRATION` (`InteractiveChat-voice.ts:189`); playback is driven by
    parsed `<speech>` segments (`InteractiveChat-speech.ts:53`), so toggling
    narration does **not** exercise `speechPlaybackMachine`. Either elicit an
    assistant reply that actually contains speech segments, or drive the
    `/dev/speech` harness (`pages/dev/components/SpeechTestHarness.tsx`), and
    confirm playback starts, advances segments, and completes.
  - `/admin` — confirm the Claude Code section shows a status rather than a
    stuck loading state (`claudeAuthMachine`).
  - Check `.callback-box/client-debug.log` after the pass for forwarded console
    errors (`docs/client-debug-log.md`).
- **Cross-model review.** Codex review of the plan before implementation and of
  the diff before the work is called done, per the monorepo `CLAUDE.md` rule.

### What the verification actually found (2026-08-01)

All automated checks passed: typecheck, lint, `doc-check`, and the full test
suite at 5524/5524. The `eslint --print-config` probe came back exactly as
specified — `paths` gone, every boundary pattern intact in both match classes,
and the outside-Vite override still correctly missing `SHARED_ALIAS_PATTERN`.

The browser pass confirmed four of the five rewired machines directly:

- `chatMachine` — the FSM transitions correctly on send
  (`enter-idle → send-from-idle → enter-streaming → stream-start` in the console)
  and renders full session history on load.
- `composerMachine` — the narration toggle flips state and re-renders.
- `speechPlaybackMachine` — **transitions**, not merely mounts. A reply carrying
  speech segments renders the "Speech options" menu; triggering "Replay" produces
  a `[wakelock] acquired` → `released` pair in the console. That wake lock tracks
  `speechPlayback.isPlaying` (`InteractiveChat-voice.ts:325`), i.e.
  `snapshot.matches("playing")`, and no transcription was active, so the machine
  demonstrably entered and left `playing`. What was **not** verified is playback
  advancing through segments with real audio — headless Chromium cannot decode
  the TTS source (`NotSupportedError: no supported source was found`), so the
  turn ends immediately. Segment advancement remains unverified.
- `claudeAuthMachine` — resolves out of `loading` into a real status on `/admin`,
  and re-queries cleanly on Refresh.
- Markdown renders correctly, covering Track 4(b2).

**One step could not be completed:** watching a turn stream to completion live.
The chat UI never leaves the streaming state because the tRPC WebSocket
subscription never delivers — the server finishes the turn in ~2s and the client
waits forever. This is **not** caused by this plan: a WebSocket connect to the
tRPC endpoint fails identically for `main`, which still had the SSR machinery at
the time. Filed as
[chat-turn-stream-never-arrives-ws](../../../issues/closed/bugs/2026-08-01-chat-turn-stream-never-arrives-ws.md).

`realtimeTranscriptionMachine` was exercised only as far as the voice-input
control rendering in its narration-mode state; driving a real microphone capture
is not something an agent can do. Both gaps are recorded here rather than
papered over — if chat or transcription misbehaves later, this paragraph and the
Failure-modes note about the missing regression net are the first places to look.

**Migration.** None. No on-disk data shape changes; no box holds `cb render`
state.

**Landing.** The plan completes on the `worktree-remove-cb-render` branch and
ships as one merge. On landing, close the tracking issue: `git mv
issues/decisions/2026-07-07-cb-render-vs-bin-browse.md
issues/closed/decisions/`, set `resolution: implemented`, add a closing note
naming the commit, and run `pnpm --dir callback-box doc-check --fix` to repair
inbound links.
