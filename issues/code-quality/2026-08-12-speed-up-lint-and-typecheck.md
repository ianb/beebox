---
title: Speed up lint and typecheck in the finish workflow
workstream: unattached
area: tooling
filed-by: agent
discovered-by: Ian
discovered-in: worktree-workstreams — reviewing finish latency
---

The finish workflow spends too much time on lint and typecheck. A measured finish run on 2026-08-12 took about 3 minutes 26 seconds. Lint and typecheck used about 81 seconds, or 39% of the total.

| Step | Time |
|---|---:|
| Root typecheck, workspace lint, and shell check | about 31.6 seconds |
| Callback-box typecheck and lint | about 49.1 seconds |

The measurement did not separate every command. The first task is to record each command independently. Check whether the finish workflow repeats callback-box lint or typecheck after the recursive root commands already ran them. Also check whether commit hooks repeat the same work before finish starts.

Do not remove a verification gate based only on similar command names. Confirm whether the commands use the same configuration, inputs, and environment. Preserve equivalent coverage when removing duplication or adding incremental execution.

Useful outcomes include:

- one timing record per lint and typecheck command;
- a map of duplicated checks across pre-commit and finish;
- removal of proven duplicate work;
- safe caching or changed-package scoping where it preserves the current gate;
- a before-and-after finish benchmark on a quiet machine.

The issue is complete when the workflow keeps the same verification contract and materially reduces the lint/typecheck wall time.

## Research (2026-08-12)

### Command map

The four commands in the measured mixed root + callback-box finish tier are not
symmetrical:

| Command | Inputs and configuration | Relationship |
| --- | --- | --- |
| root `pnpm typecheck` | root `tsconfig.json` only | Additive; it does not cover either callback-box config. |
| root `pnpm lint` | every workspace package's `lint` script | Includes callback-box lint. Before this change it also invoked the frontend workspace lint after callback-box lint had already invoked that exact frontend command. |
| callback-box `pnpm typecheck` | backend `tsconfig.json`, then frontend `src/frontend/tsconfig.json` | Additive to root typecheck. The two callback-box configs are independent. |
| callback-box `pnpm lint` | backend `eslint.config.mjs` over `src/`, `scripts/`, and `test/`, then frontend `src/frontend/eslint.config.mjs` over `src/` | Exact duplicate when root lint has already run; otherwise required as the package-local gate. |

The backend ESLint config explicitly ignores `src/frontend/**`, so retaining
both callback-box lint halves is necessary. The safe removal is only the second
invocation of the same frontend workspace command, not either configuration or
any input directory.

`typecheck:all` had no script or CI caller. Its definition ran `typecheck`
(which already covered backend + frontend) and then ran `typecheck:frontend`
again. It was removed, and its one historical plan reference now names the
canonical `typecheck` command.

### Commit hook overlap

Every commit runs `path-leak-check`, `commit-blocklist-check`, and the
mobile-contract tripwire; markdown commits also run `doc-check`. A commit with
callback-box code runs staged-file ESLint plus the full callback-box typecheck.
Finish then runs full callback-box lint and typecheck after merging main. The
lint checks are not equivalent (staged files versus the full package), while
the typecheck is repeated when finish first commits stragglers. That repetition
remains: the post-merge finish result is a distinct gate and the hook does not
leave a durable result tied to the final tree.

For a finish touching both root tooling and callback-box, root recursive lint
and package-local callback-box lint were exact duplicates. The finish procedure
now coalesces package lint when root lint is selected. Tests and typechecks are
not coalesced.

### Timing records

Measured sequentially on a 12-core Mac with Node 24.18.0. Before-command load
averages ranged from 3.80 to 4.79. Free memory ranged from 100 MB to 2.6 GB at
the individual command boundaries; compressor occupancy was 4.2 to 5.9 GB.
Each command recorded zero swaps while running, but the laptop retained heavy
compression and historical swap activity from other agent sessions. These are
comparable working-condition timings, not a pristine quiet-machine benchmark.

| Command | Before | After | Change |
| --- | ---: | ---: | ---: |
| root `pnpm typecheck` | 2.71 s | 2.12 s | no design change; cache/load variation |
| root `pnpm lint` | 51.12 s | 31.41 s | 19.71 s faster (39%) |
| callback-box `pnpm typecheck` | 13.27 s | 7.63 s | 5.64 s faster (43%) |
| callback-box `pnpm lint` | 44.47 s | 25.88 s | 18.59 s faster (42%) |

The after scripts run backend and frontend callback-box passes concurrently.
Root lint filters only the separately enumerated `callback-box-frontend`
workspace because callback-box lint runs that same command. In the mixed root +
callback-box finish tier, lint coalescing also omits the second callback-box
lint, reducing the observed command sequence from 111.57 seconds to 41.16
seconds under these working conditions (63%). A complete quiet-machine finish
benchmark is still required before closing this issue.

The two-pass concurrency can raise peak memory versus the old sequential
callback-box commands. It is bounded to the backend and frontend child scripts;
the aggregate uses pnpm's local regex-script mode rather than workspace-wide
`--parallel`. This is the principal tradeoff to re-check in the quiet-machine
finish benchmark.

### Failure-propagation probes

An independent cross-model review identified child failure propagation as the
highest-risk assumption. A temporary frontend file containing both an ESLint
error and a TypeScript error produced non-zero exits through all three relevant
layers:

- callback-box `pnpm lint`: frontend ESLint 1 → aggregate 1;
- callback-box `pnpm typecheck`: frontend TypeScript 2 → aggregate 2;
- root `pnpm lint`: callback-box aggregate 1 → recursive root command 1.

A deliberately empty regex script match also exits 1 with
`ERR_PNPM_NO_SCRIPT`, so a future rename cannot silently turn either aggregate
into a successful no-op. A root test locks the second half of the frontend
coverage invariant: the workspace exclusion is allowed only while callback-box
lint retains its backend and frontend scripts with the full input sets.
