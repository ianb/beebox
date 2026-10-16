---
title: "DOM doctests for frontend effects, events, and render counts"
status: draft
workstream: frontend-dom-harness
issues:
  - ../../../issues/code-quality/2026-10-10-frontend-has-no-dom-effect-test-harness.md
  - ../../../issues/code-quality/2026-10-08-chat-message-list-rerenders-per-token.md
---
# DOM doctests for frontend effects, events, and render counts

Frontend doctests can render React only to a static string today, so effects,
event handlers, and re-render behavior are checked by hand in a browser. This
plan adds a small harness that mounts components in a happy-dom document from a
doctest, runs them through the React Compiler as the Vite build does, and counts
which components rendered. It then uses the harness to fix the chat message
list, whose settled rows re-render on every streamed token.

**Issues addressed:**
`issues/code-quality/2026-10-10-frontend-has-no-dom-effect-test-harness.md` (the harness)
and `issues/code-quality/2026-10-08-chat-message-list-rerenders-per-token.md`
(the first render-count fix). A queue grep for `happy-dom`, `jsdom`, `DOM shim`,
`re-render`, and `render count` found no other open item about either.

## Design

No design section: test infrastructure and a render-performance fix. What a
person sees in chat does not change.

## Smallest fix and budget

Smallest fix for the re-render issue: drop `streamText` and `streamTools` from
the row context, wrap `GroupItem` in `memo`, and keep settled rows' ack arrays
stable across tokens. About 30 changed lines in two files. Without a harness,
that fix is verified once by hand and can regress silently.

Chosen scope, estimated changed lines (additions plus deletions):

| Track | Source | Tests | Docs |
|---|---|---|---|
| A. DOM harness + compiler load hook | ~170 (3 helper files, `.taprc`, `package.json`) | — | ~60 (`docs/testing/doctests.md`, `docs/testing.md`) |
| B. Regression doctest for the app-bar place hook | — | ~40 | — |
| C. Message-list render fix + doctest | ~40 | ~70 | ~10 (`components/chat/AGENTS.md`, net shrink) |

Total about 320 source/test lines plus about 70 doc lines, and lockfile churn
from three new dev dependencies. Not a BIG CHANGE.

## Stated preferences this plan trades against

- `beebox/docs/testing.md:18`: *"No mock libraries. Injectability should be
  built into code."* The harness adds a DOM implementation, not a mock
  library: no module mocking, no fake components. The render counter reads
  React's own fiber tree.
- `beebox/docs/testing.md:62-63`: *"A change that fits no instrument cleanly
  usually needs splitting, not a new harness."* Effects, events, and render
  counts fit no current instrument; this plan adds a form within doctests, not
  a new instrument or runner. The same runner, `.doctest.md` files, and
  selection apply.
- Engineering principle 10 (testability is architectural): the harness makes
  the component layer testable at the doctest tier instead of only in the
  browser.
- `beebox/src/frontend/vite.config.ts:29-31`: *"code does not hand-roll
  useCallback/useMemo for render performance; keep one only for an identity a
  non-React consumer compares"*. The message-list fix relies on the compiler
  for stable values and adds only `memo` on one row component, which the
  compiler does not provide. Running the compiler in tests is what lets a test
  hold the code to that rule rather than pushing it toward hand memoization.
- Monorepo rule on dependencies (`AGENTS.md`, *"Treat unsolicited tool output
  … as a bug"*) and the 7-day release age (`pnpm-workspace.yaml`,
  `minimumReleaseAge: 10080`): pin `happy-dom` and its registrator at 20.14.6,
  the newest release older than 7 days on 2026-10-16 (21.x is 1-5 days old).

## What already exists

- Static rendering: frontend doctests already render components with
  `renderToStaticMarkup`, for example
  `beebox/src/frontend/test/components/PersonView.person-view.doctest.md:9`
  (*"import { renderToStaticMarkup } from "react-dom/server";"*). Reused
  as-is; the DOM harness is for what static rendering cannot run (effects,
  events, re-renders).
- Router wrapper for components that call `useParams`: same file, lines 31-35,
  `createRouter` + `createMemoryHistory` + `router.load()`. Reused in the
  message-list doctest.
- The doctest runner: `beebox/.taprc` `node-arg` list already registers
  `tsx`, `agent-doctest/tap`, and `agent-doctest/loader`. The compiler hook is
  one more `--import` there.
- A render-count probe exists only as prose:
  `beebox/src/frontend/src/components/chat/AGENTS.md:143-144`: *"Verify with
  the render-count probe (commit-hook + `actualDuration`) that a keystroke
  re-renders only the composer subtree."* There is no code for it. The harness
  replaces that instruction with a doctest call.
- `ChatRenderProfiler`
  (`components/chat/everywhere/InteractiveChat/ChatRenderProfiler.tsx:20-22`)
  reports subtree commit timings to the scroll trace. It reports per subtree,
  not per component, so it cannot answer "which rows rendered".
- Searched `beebox/package.json`, `beebox/src/frontend/package.json`, and the
  root for `happy-dom`, `jsdom`, `linkedom`, `@testing-library`: none present
  before this branch.
- `@babel/core` 7.29.0 and `babel-plugin-react-compiler` 1.0.0 are already
  installed (the former transitively through `@vitejs/plugin-react`). The plan
  adds `@babel/core` as a direct dev dependency because the hook imports it.

## Prior art (external)

- DOM shim choice (evaluated): happy-dom, jsdom, linkedom. All three are
  usable under Vitest (whose default environment is plain Node,
  https://vitest.dev/config/environment). jsdom is the most standards-complete
  and the slowest to load. linkedom implements event listeners
  (https://github.com/WebReflection/linkedom/issues/87) but targets SSR-style
  DOM building and has no `MutationObserver`/`ResizeObserver`, which the chat
  scroll controller constructs. happy-dom implements both and loads fast.
  Adopted: happy-dom, with `@happy-dom/global-registrator` to install
  `window`/`document` on `globalThis`. Verified in the spike: React 18.3.1 `createRoot` + `act`
  mount, rerender, effects, and unmount under happy-dom 20.14.6.
- `act` from `react` (evaluated, adopted): React 18.3 exports `act`
  (`node -e "typeof require('react').act"` → `function`); it replaces the
  deprecated `react-dom/test-utils` export. Requires
  `globalThis.IS_REACT_ACT_ENVIRONMENT = true`.
- Render counting (adapted from React DevTools' approach): React calls
  `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` after every commit when the
  hook exists at React DOM load. DevTools decides "did this fiber render" from
  the `PerformedWork` flag and skips subtrees whose child pointer did not
  change. https://github.com/facebook/react/blob/v18.3.1/packages/react-devtools-shared/src/backend/renderer.js
  (`didFiberRender`). react-scan uses the same signal. No ACKNOWLEDGEMENTS
  entry: the idea is adapted in about 20 lines, no code copied.
- `@testing-library/react` (evaluated, not adopted): it adds queries and
  `render`/`rerender` wrappers. The harness needs only mount, rerender, act,
  unmount, and render counts; `container.querySelector` and `textContent`
  cover the reads. No library dependency for three functions.
- React Compiler outside Vite (no prior art found for a Node load hook; the
  pipeline mirrors `@vitejs/plugin-react`, which runs Babel with the compiler
  on TSX source and leaves TypeScript and JSX to esbuild).

## Ontology

- **DOM doctest**: a `.doctest.md` whose setup imports
  `test/helpers/dom-harness.ts` first. Not a new file kind or runner.
- **`mount(element)`**: new, in `dom-harness.ts`. Returns a `Mounted` handle:
  `container`, `rerender`, `act`, `renders`, `resetRenders`, `unmount`.
- **Render count**: number of times a named function, class, forwardRef, or
  simple-memo component performed work in commits of one mounted root. Keyed
  by `displayName ?? name`. Not a timing and not a DOM mutation count.
- **Compiled module**: a frontend `.ts`/`.tsx` module transformed by
  `react-compiler-hooks.ts` (Babel + `babel-plugin-react-compiler` target 18,
  then esbuild). Same options as `vite.config.ts:80-83`.
- Existing names used unchanged: `MessageList`, `GroupItem`,
  `RenderItemContext`, `buildDataItems`, `DataItem`
  (`components/chat/everywhere/InteractiveChat/message-items.tsx`,
  `messages.tsx`); `useAppBarPlace`, `AppBarChromeProvider`
  (`components/app-bar-chrome.tsx`).

## Tracks / scope

### Track A: the harness

- **What.** Three helper files under `beebox/src/frontend/test/helpers/` and
  one `.taprc` line.
  - `components/helpers/dom-globals.ts` (side-effect module): registers
    happy-dom globals, sets `IS_REACT_ACT_ENVIRONMENT`, installs a minimal
    `__REACT_DEVTOOLS_GLOBAL_HOOK__` that forwards commits to listeners and
    records React DOM's `inject` call.
  - `components/helpers/dom-harness.ts`: imports `dom-globals.js` first, then
    `react` and `react-dom/client`; exports `mount`. `mount()` throws
    `HarnessLoadOrderError` when React DOM never connected to the hook (it
    loaded first), so a dead render counter cannot pass silently. The layout
    check places these two beside their users (`test/components/`); they move
    up when a test elsewhere imports them.
  - `react-compiler-hooks.ts` + `react-compiler-register.ts`: a Node `load`
    hook, registered after `agent-doctest/loader` in `.taprc`, that compiles
    frontend modules with the React Compiler and caches the output under
    `beebox/src/frontend/node_modules/.cache/react-compiler-doctests/`.
- **Why.** Effects and re-render behavior can be checked today only in a
  browser. Three recent bugs were caught by review or the browser (issue
  text). Without the compiler in tests, render counts would not match
  production: the compiler memoizes JSX inside each component, and that is
  the layer the last two re-render bugs defeated (`cb5e8cc24`).
- **Direction.**
  - `mount(element: ReactNode): Promise<Mounted>`; every method that changes
    React state runs inside `act` and resolves after effects flush.
  - `renders(): Record<string, number>` sorted by name, so doctest output is
    stable.
  - The compile hook covers the client modules the frontend tsconfig
    includes: `beebox/src/frontend/src/**/*.{ts,tsx}`,
    `beebox/src/schemas/*/list-entry.tsx`, and `beebox/src/plugins/*/view.tsx`.
    Not backend `.tsx` (`src/schemas/<type>.tsx`, `src/schemas/guide/compile.tsx`)
    and not `src/shared/`, which also run on the server. It defines `import.meta.env` as
    `{ DEV: true, PROD: false, MODE: "test", SSR: false, BASE_URL: "/" }`,
    because esbuild leaves `import.meta.env` undefined and
    `lib/scroll-diagnostics/diagnostics.ts:156` reads `.DEV` at module load.
  - Cache key: SHA-256 of hook source, compiler version, file path, file
    source. Write to a temp name and rename, so parallel tap processes never
    read a partial file.
- **Vocabulary lock-ins.** `mount`, `Mounted`, `renders()`,
  `resetRenders()`. The helper path `src/frontend/test/helpers/`.
- **First implementation chunk.** The four helper files, `.taprc`, the three
  dev dependencies, and the docs section. Done when all existing frontend
  doctests pass with the hook (spike: 197 files, 2484 tests, only the two new
  draft files failing on placeholder output).

### Track B: app-bar place regression doctest

- **What.** `test/components/app-bar-chrome.place-owners.doctest.md`: a chat
  publisher and a Browse publisher under `AppBarChromeProvider`; the chat's
  label changes; the bar must still show Browse; Browse unmounts; the bar
  shows the chat's new label.
- **Why.** This is the place-pill effect-cleanup bug from the issue
  (`e22c56ead`, *"useAppBarPlace's effect cleanup cleared the owner's entry
  whenever dir or label changed"*). Spike: with `e22c56ead` reverted, the
  doctest's second line reads `Kitchen chat` instead of `Browse: recipes`.
- **Direction.** No source change. The doctest proves the harness runs effect
  cleanups and ordering.
- **First implementation chunk.** The doctest file.

### Track C: message rows render once per change

- **What.** Settled message rows stop re-rendering per streamed token.
- **Why.** Spike doctest, five tokens streamed into a three-entry chat:
  `GroupItem` 16 renders, `UserMessage` 5, `AckBadgeCluster` 5, `AckBadge` 5.
  Expected: only the streaming row renders. Causes, read from source:
  1. `renderCtx` (`messages.tsx:272-289`) includes `streamText` and
     `streamTools`, so it is a new object per token. No consumer reads them:
     `GroupItem` destructures neither (`message-items.tsx:206`) and
     `renderDataItem` reads only `onHqSendLive` and `captureVerbs`.
  2. `GroupItem` is a plain function component. The parent rebuilds every row
     element when `data` changes, which is every token (`messages.tsx:202-205`
     lists `streamText` in the deps), so each `GroupItem` renders.
  3. `buildDataItems` creates a new `acks` array for every user group with
     acks on each call (`message-items.tsx:137`, *"last.acks = [...(last.acks
     ?? []), ...groupAcks];"*), so that row's `UserMessage` re-renders.
- **Direction.**
  - Remove `streamText` and `streamTools` from `RenderItemContext` and from
    the `renderCtx` value.
  - Remove `lastAssistantGroupIndex` from `RenderItemContext`. It changes when
    a reply's first paragraph shows, which would re-render every row once per
    turn. `renderDataItem` takes it beside the context and passes each
    `GroupItem` a boolean `latestAssistant`, so only the two rows the
    highlight moves between change.
  - Build the context in a hook, `useRenderItemContext`, with its own
    `useMemo`. Found while implementing: the React Compiler drops the
    existing `useMemo` in `MessageListInner` and memoizes the context inside
    the scope of the returned JSX, which depends on `data`, so the context was
    new on every token even with no per-token field. A plain hook without a
    hook call is not compiled (infer mode), so the hook keeps `useMemo`.
  - Split `buildDataItems` into the settled part (groups, markers,
    `debugView`, `proseEnabled`) and the tail (pending HQ, capture bubbles,
    the streaming group). `MessageListInner` computes the two separately, so
    settled items, including their `acks` arrays, keep identity while only
    the tail changes. `buildDataItems` stays as the composition of the two for
    its existing doctest caller
    (`test/components/chat/message-parsing.empty-assistant.doctest.md:7`).
  - Wrap `GroupItem` in `memo` (`GroupItemInner` + `memo`, the file's
    `MessageListInner` pattern).
- **Vocabulary lock-ins.** `buildSettledItems`, `buildTailItems`,
  `useRenderItemContext`, `latestAssistant`.
- **First implementation chunk.** The render doctest asserting per-token
  renders of settled rows are zero, then the source change.

## Could this be simpler?

- **Simplest: fix the rows by hand, verify in the browser with React DevTools,
  no harness.** Fails the first issue outright, and the second issue's own
  text says *"there is no automated measurement"*; the next prop that defeats
  memoization regresses silently, as `cb5e8cc24` and this issue both did.
- **Harness without the React Compiler hook.** Saves ~60 lines. It fails on
  render counts: without the compiler, every child of a re-rendering
  component renders, so the doctest would either fail on rows the compiler
  already protects in production or push the code to hand-written
  `useMemo`/`useCallback`, against `vite.config.ts:29-31`. It also could not
  catch the class `cb5e8cc24` fixed (a rest-spread defeating compiler
  memoization). Effects-only doctests (Track B) would work without it.
- **Opt-in compilation per doctest** instead of all frontend modules. ESM
  loads a module's whole static import graph before evaluating any of it, so
  a hook registered by a doctest's setup block cannot affect the modules that
  block imports; opting in would require every DOM doctest to use dynamic
  `import()`. Global registration also makes the existing static-render
  doctests run the code production runs. The cost is bounded by the cache:
  first run of the frontend subset 36.7 s → 55.8 s wall; warm runs of
  `PersonView` and `message-parsing.empty-assistant` took 1.34 s each versus
  1.6 s uncompiled.
- **No custom render counter, use `<Profiler>`.** `Profiler` reports a subtree
  commit, not which components inside it rendered; the issue needs per-row
  counts.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A doctest imports a component before `dom-harness.ts`, so React DOM loads without the window or DevTools hook | No | `mount()` throws `HarnessLoadOrderError` | Clear |
| React changes fiber internals (tags, `PerformedWork`) on an upgrade to 19 | No | None | Silent-ish: counts change; render doctests fail on numbers, not silently pass, because they assert exact counts including the streaming row |
| The compile hook mis-compiles a file the Vite build compiles differently (options drift) | The frontend subset passing under the hook | Same options, comment points at `vite.config.ts` | Silent if drift only changes memoization |
| Cache returns stale output after a compiler upgrade | No | Compiler version and hook source are in the key | — |
| Two tap processes compile the same file at once | No | Write-temp-then-rename | — |
| A backend test process loads a client module (list entry, plugin view) and now runs compiled code | Backend tests importing those files were run under the hook | Path list limited to client modules | Clear (a test fails) |
| The compiler folds a manual `useMemo` into a larger memo scope, defeating a memoized child | The message-list render doctest | `useRenderItemContext` | Clear in render doctests; silent elsewhere |
| happy-dom lacks an API a component touches (layout, `scrollTo`) | No | None; the doctest fails on the missing API | Clear |
| `GroupItem` memo hides a needed update (a prop read through `ctx` that changes while `ctx` identity holds) | Message-list doctest: the speaker highlight moves to the streaming row, then stays on the finalized row | `ctx` members are all listed in its deps | Clear in doctest |

No critical gap: no row is both untested and silent with no handling.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-facing vocabulary.
- Stale ref, two agents on one card, hand-edit drift, fabricated values,
  validation UX: not applicable; no card or tag change.
- Partial migration / transition state: none. Existing doctests keep working;
  the spike ran them all under the hook.
- A future agent writes a DOM doctest that never unmounts: ADDRESSED by the
  docs example ending with `unmount()`; each tap file is its own process, so a
  leak cannot cross files.

## NOT in scope

- A fixture-backed full chat view (`InteractiveChat` with a scripted chat
  machine). The issue's blank-assistant entry suggests it; the message-list
  doctest covers row rendering, and the chat machine already has its own
  doctests (`test/machines/chatMachine.*`). Not now: it needs the transport,
  composer, and workspace providers.
- The exhibit recorder cleanup bug: it lives in `workstreams-app/`, a separate
  package with its own test setup.
- Converting existing `renderToStaticMarkup` doctests to `mount`. They test
  static output and work.
- Other render hot spots (`InteractiveChat` itself, 108 renders per turn, is
  expected per the issue).
- React 19 upgrade.

## Plan review

Cross-model review (codex gpt-6-sol), adjudicated:
- `lastAssistantGroupIndex` in the shared context: accepted; Track C direction.
- Compile hook covered backend `.tsx`: accepted; restricted to client modules.
  Rejected its other remedy, opt-in loading from DOM doctests with dynamic
  imports: global loading also makes static-render doctests run compiled code,
  and the cache removes the cost.
- Claimed finalize and speech coverage that the doctest lacked: accepted; the
  doctest's second example.
- Silent dead counter when React DOM loads first: accepted; `HarnessLoadOrderError`.
- Suspense boundary of render counts, and two wrong shim claims: accepted;
  documented and corrected.

## Open design questions

none. The DOM shim (happy-dom), compiler-in-tests, and global hook registration
are settled in *Could this be simpler?* and *Prior art*.

## Knowledge audits

Skip: purely developer tooling; no box-agent-facing concept.

## What will hold this after it ships

The harness's own doctests (Tracks B and C) exercise it on every run that
selects them. The docs section in `docs/testing/doctests.md` is what the next
agent reads; `docs/testing.md`'s *Reproducing a bug* list names DOM doctests
for effect and render bugs. The render doctest asserts exact counts for the
settled rows (zero per token) and the streaming row, so a new unstable prop
fails it.

## Implementation order

1. Track A: dependencies, helpers, `.taprc`, docs. Commit.
2. Track B: app-bar place doctest. Commit (may join 1).
3. Track C: render doctest (red), then the fix (green). Commit.
4. Update `components/chat/AGENTS.md:142-144` to point at the harness in place
   of the prose probe. Commit with 3.
5. Cross-model diff review; adjudicate.

## Rollout shape

Done when:
- `pnpm exec tap 'src/frontend/test/**/*.doctest.md'` passes from `beebox/`.
- The app-bar doctest fails with `e22c56ead` reverted (checked in the spike).
- The message-list doctest shows zero settled-row renders per token after the
  fix, and the fix's absence makes it fail.
- `pnpm typecheck`, `pnpm lint:changed`, and the layout check pass.
- `pnpm install` prints no new warnings (the deprecated-subdependency line is
  pre-existing).

No migration; no knowledge audit.
