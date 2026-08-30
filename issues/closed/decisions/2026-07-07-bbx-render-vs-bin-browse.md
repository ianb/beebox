---
title: "bbx render vs bin browse"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — after fixing bbx render's SSR crash and building bin/browse prod access, the boxholder questioned whether bbx render earns its keep
resolution: implemented
---

> **Resolved 2026-08-01: removed.** `bbx render` and its SSR entry graph are
> gone (commits `45c36049`, `45c9aa7c`, `0ee5b6e8`; five call sites rewired
> off `useSSRMachine` to `useMachine` in `45c9aa7c`). See
> [remove-bbx-render](../../../beebox/docs/implemented-plans/remove-bbx-render.md)
> for the removal plan.

`bbx render` (React SSR → HTML, `src/cli/commands/render.ts` + `src/frontend/src/ssr/`)
and `bin/browse` (real headless Chromium, now with prod access via
`deploy/prod-browse`) overlap on "look at a page without clicking through the
app." The boxholder isn't sure `bbx render` is worth its complexity — it was "kind
of into the idea" more than a load-bearing tool. Decide whether to keep+fix or
remove it.

## The honest case against (why this is filed)

- **It's currently broken past the crash.** Even after the SSR-safety fixes
  (see [bbx-render-ssr-window-undefined](../bugs/2026-07-07-bbx-render-ssr-window-undefined.md)),
  `renderToString` yields an empty `<body>` — the app is React-Query/Suspense-
  driven and `renderToString` doesn't await Suspense. Making it emit real content
  needs streaming SSR (`renderToPipeableStream`) or a non-suspense prefetch path:
  a real project, not a tweak.
- **`bin/browse` covers the common need better.** It renders the *actual running
  app* with real data and can screenshot it (visual truth, not inferred-from-HTML).
  With `deploy/prod-browse` it now works against prod-as-owner too. For "does this
  page look right / is it broken," browse is strictly more faithful.
- **No current dependents found.** No `.doctest.md` exercises `bbx render`; grep
  turned up only docs/prose references, not code or test callers.

## The case for keeping (what browse can't do)

- **Arbitrary-state exploration.** `bbx render` can render a page in a state that
  doesn't exist in any box: `--scenario streaming`, `--machine chat=idle`,
  `--mock status.status={...}`. `bin/browse` can only show states the running app
  actually reaches. This is the one genuinely unique capability.
- **Semantic HTML for agents, headless, fast.** Output is parseable HTML with
  `--selector` extraction; no browser/GPU, cheap in CI. Originally chosen over
  pixel screenshots for exactly this (stack-decisions.md Decision 1, §931).
- It's wired into the XState SSR-state-injection design (`useSSRMachine`,
  `SSRStateContext`, `state-registry*`), so removal isn't just deleting a command.

## If removed, the surface

`src/cli/commands/render.ts`; `src/frontend/src/ssr/` (render.tsx, setup.ts,
state-registry-\*, noop-trpc.ts, css-loader.mjs, register-loader.mjs);
`docs/ssr-render-testing.md`; the SSR-state-injection machinery (`useSSRMachine`,
`SSRStateContext`) and incidental accommodations (`FriendlyDate`'s
`suppressHydrationWarning`); and references in `CLAUDE.md`, `frontend.md`,
`docs/stack-decisions.md`. The five SSR-safety guards from the crash fix are
worth keeping regardless (they're cheap and correct).

## The decision that settles it

Does anyone actually use — or intend to use — the arbitrary-state exploration
(`--scenario`/`--machine`/`--mock`)? If yes, fix the Suspense render and keep it.
If it was aspirational and never adopted, remove it and let `bin/browse` (+
`prod-browse`) be the one way to look at pages. Leaning toward removal given the
empty-render lift and browse now covering the real need — but the state-injection
capability is the thing to consciously give up, not drop by accident.
