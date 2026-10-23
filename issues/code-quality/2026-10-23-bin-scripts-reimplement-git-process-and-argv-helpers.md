---
title: "`bin/` scripts each write their own git, process, and argument helpers"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-backend — backend pass of the functional-duplication sweep
---

`bin/test-git.ts` has `git`, `gitCommonDir`, and `changedPaths`, and
`beebox/src/hub/child-process-utils.ts` has `killGroup`, `pidAlive`, and
`waitForHttp`. Many scripts write their own versions with different failure
contracts. The duplication sweep merged only the exact copies; these remain.
The `flags` parsers in `bin/comments.ts` and `bin/lib/schedules-cli-context.ts`
now share `bin/lib/value-flags.ts` (commit 52b3a72d5).

## Run git and return stdout

About 10 wrappers, each with a different contract:
`bin/test-git.ts:23` (throws, strips one newline),
`bin/smoke-harness.ts:78` (trims, "" on failure),
`bin/commit-provenance.ts:45` (throws, no trim),
`bin/deploy-status.ts:85` (trims, null on failure),
`bin/doc-lifecycle-check.ts:55`, `bin/coding-feedback.ts:56`,
`bin/lib/schedules-branch.ts:36` (returns `{ok, stdout, stderr}`),
`bin/lib/skill-usage-catalog.ts:42` ("" on any error),
`beebox/src/core/box/backup-status.ts:156`.

The same split shows in narrower helpers: repository top level
(`rev-parse --show-toplevel`, about 15 sites), common directory
(`--git-common-dir`, about 12 sites), current branch, and HEAD sha (about 15
sites, failure value "unknown", null, "", or a throw).

## Processes

The sweep moved the `bin/` copies of `pidAlive`, `killGroup`, and
`bootTimeMs` onto the shared ones. The dev router still has its own
`killGroup` (`workstreams-app/src/router/server/real-effects.ts:251`,
`workstreams-app-effects.ts:195`) and `pidAlive` (`real-effects.ts:196`).
HTTP readiness polling has several variants:
`workstreams-app/src/router/server/real-effects.ts:276` copies `waitForHttp`,
including the error class name, but accepts any status;
`beebox/src/dev/perf/local-hub.ts:155`, `beebox/src/scripts/smoke-external-box.ts:194`,
and `bin/smoke-probe.ts:142` are further variants.

The dev router keeps its own copies on purpose
(`workstreams-app/src/router/effects.ts:137`), but its comment there says
"bin/ can't import beebox's guards", which is no longer true: many `bin/`
files import `beebox/src/shared/error-guards.ts`.

## Argument parsing

About 20 scripts parse argv by hand (`for` loop with `argv[++i]`) and four
local functions are named `parseArgs`. About 10 scripts already use
`node:util` `parseArgs` (`bin/issues-args.ts`, `bin/finish-verify.ts`,
`bin/cross-model-run.ts`). The hand loops differ in which flags they accept
and in their error text.

## Why this was not merged in the sweep

There is no single canonical form for git or process helpers: the failure
contract (throw, null, or empty string) is part of each caller's logic.
A shared `bin/lib/git.ts` with an explicit failure mode per call, and a move
to `node:util` `parseArgs` per script, are each a reviewable change of their
own. Whether the dev router may import from `beebox/src` is the router
owner's call.
