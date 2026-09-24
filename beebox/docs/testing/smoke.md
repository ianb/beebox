# Smoke
**Run:** `bin/smoke` (add `--box <slug>`; `--no-restart` when debugging the
walk itself). ~30s, hard-fails, never selected by the test graph.

The only tier that answers "does the app actually run". It restarts this
checkout's dev-server generation through the router's control socket, waits for
the box's **backend** to answer `/api/health` (vite serves pages seconds before
Fastify is up, and a box child reloads itself after a post-commit CLI rebuild —
both looked like a 502 flake until 2026-08-26), then walks it in a browser: the chat page renders its shell,
the app bar's place menu opens and lists landmarks, selecting one moves you there, `/browse` lists the box's
real content, a card opens and renders, and the page raised no uncaught errors.
No model turns — nothing that spends tokens or waits on an agent.

It exists because three escapes on 2026-08-25/26 passed typecheck, lint and
their selected tests while the app was broken: the code was right and the
*state* was wrong (a missing frontend build, broken global `~/.codex` state, an
SDK item outside its own union). Only a real box on the real machine shows
those.

**Where it runs.** `/finish` names it on the decision sheet for any diff that
touches a deployed path (`bin/deployed-paths.ts` — the same rule the deploy
hook uses to decide whether a commit ships), and `bin/finish-verify` runs it
*before* `bin/land`. It is a gate, not a post-merge alarm, because the router
runs TypeScript straight off disk and never reloads it: after the merge, the
main checkout's running generation is still the old source, so there would be
nothing correct to point at. The worktree at that moment already contains main
and is byte-identical to what lands.

A failing test file gets a flake re-run; the smoke walk does not. It boots one
real box and either that works or it does not.

**Post-deploy**, `deploy/deploy.sh` runs the server-side half: hub `/healthz`,
a `/healthz/canary` that cold-starts one real box, and an assertion that the
shipped `src/frontend/dist/index.html` exists. That last one is the condition
`registerSpaFallback` branches on — without the build, every page navigation
404s while both health checks stay green. It asserts the file rather than
probing a URL because the hub redirects an unauthenticated navigation to login
before the child is reached, so a URL probe answers 302 either way. It is not
duplicated in the local walk: in dev, page requests are served by vite and
never reach that handler at all.

**Every run is logged, so the tier can be trimmed on evidence.** Each walk
appends a line to `callback-smoke-log.jsonl` in the shared git dir (beside the
test ledger, and shared by every worktree on the machine for the same reasons):
the verdict, which step failed, and every step's outcome and duration.
`bin/smoke --report` folds it into per-step counts — how often each step ran,
how often it caught something, what it costs at p50. A step that has never
failed across many runs is paying rent out of the budget, and the report names
those once there are enough runs for a clean record to mean anything.

**Breaking it on purpose: declare it.** Proving the tier can still go red means
breaking something, and the resulting red is indistinguishable in the log from
one the tier caught for real — the first weekly review duly read one as an
intermittent worth watching. So say what you broke:

```
BBX_SMOKE_FAULT_INJECTION="hub throws at import" bin/smoke
```

The reason is stamped on the run, the walk says so loudly while it runs, and
every count in `--report` and in the weekly review excludes it. A step's
`forced` column counts these separately from `failed`: firing on demand proves
the step is wired up, never that it has caught anything.

Read `ran` as the denominator, not the run count: the walk stops at the first
failure, so a late step has seen fewer runs than an early one. Steps are keyed
by a stable id, not their printed name, so rewording a step keeps its history.

**A weekly schedule reviews the tier's shape** (`schedules/smoke-review/`). It
gathers the log, the window's failures, and the bugs filed that week, then hands
them to a session that asks two questions: is every step still earning its
place, and is there something the walk should be checking that it isn't. The
second half is necessarily after-the-fact — a bug that reached `main` and was
only visible on a running box is what "the walk has a hole" looks like, and the
hourly full-suite run's own issues are the sharpest evidence for it. The session
files an issue; it does not edit the tier, because trimming a step or adding one
belongs to a session that can run the walk and see what happens.

**It is disruptive, on purpose.** The walk stops this checkout's dev-server
generation and closes the shared browse session (tours and interactive
`bin/browse` share one Chrome). If the boxholder has this worktree open in a
browser, their tab reloads. That is the cost of testing the code that is about
to land rather than whatever was running.

**Known gap.** A change confined to `bin/` gets no smoke walk, because `bin/`
ships nothing and the "code-related" rule is deliberately the deploy hook's. A
`bin/router.ts` change that breaks the dev router is therefore not gated here.
