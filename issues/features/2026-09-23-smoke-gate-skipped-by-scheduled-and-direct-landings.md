---
title: "Scheduled sessions and direct commits land deployed-path changes without a smoke walk"
workstream: smoke-review
area: monorepo
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: worktree-smoke-review — the weekly smoke-tier review, 2026-09-23
priority: backlog
---

> **Naming note (2026-10-18):** doctests (`*.doctest.md`) are now `.test.ts` files with `t.check`, in the same directory under the same base name, and `agent-doctest` is now `tap-check/` (`@ianbicking/tap-check`). See `beebox/docs/implemented-plans/retire-doctest.md`.

The smoke tier gates a landing only when the landing goes through `/finish`:
`bin/finish-verify` runs `bin/smoke` before `bin/land`. Two other landing
paths reach `main` with deployed-path changes and run no walk:

1. **Scheduled sessions that call `bin/land` directly.** The prompts for
   `sdk-update`, `knip-sweep` and `supplemental-lint` each tell the session to
   run tests and then `bin/land`. None of them mentions `bin/smoke`, and
   `bin/land` does not run it. These schedules change what boots:
   `sdk-update` bumps agent-SDK and Codex pins in `beebox/package.json` and
   `pnpm-lock.yaml`, and `knip-sweep` deletes code across `beebox/src`. A
   dependency bump and a deletion whose consumer the tests do not cover are
   both failures that a boot-and-walk shows and a unit tier does not.
2. **Commits made directly on `main`** in the main checkout. These do not go
   through `/finish` at all.

This is a different hole from the known `bin/`-only gap. That gap is a
deliberate rule about which paths count as code. These landings do touch
deployed paths, so the rule says they should be walked.

## Evidence

Window 2026-09-16T19:28Z to 2026-09-23T19:38Z. A landing counts as code when
its first-parent diff matches `DEPLOYED_PATHS_PATTERN`
(`bin/deployed-paths.ts`). A landing counts as walked when
`beebox-smoke-log.jsonl` has a run on the same branch in the 6 hours before
the merge.

- 53 code landings; 38 walked; 15 not walked.
- No walk is logged after 2026-09-21T19:10Z. Both code landings since then are
  schedule merges.

Schedule merges with no walk (6):

- `44ca9d361` 2026-09-22 `worktree-sdk-update` (`beebox/package.json`, `pnpm-lock.yaml`)
- `a0730c635` 2026-09-19 `worktree-sdk-update`
- `816e8ff67` 2026-09-18 `worktree-sdk-update`
- `faaf325f6` 2026-09-17 `worktree-sdk-update`
- `58dcd6e6b` 2026-09-23 `worktree-knip-sweep` (deletions in `beebox/src/cli/commands/`
  and elsewhere). The only logged walk on this branch is from 2026-09-10, and
  it is red.
- `a038b16e4` 2026-09-19 `worktree-supplemental-lint` (`beebox/src/core/box/file-watcher.ts`,
  `beebox/src/schemas.ts`)

Direct commits on `main` with no walk (9). Three change only doctests and are
arguably exempt:

- `3db19d271` `beebox/src/frontend/src/components/admin/SecretsSection/forms.tsx`
- `b0bd513c8` `beebox/src/frontend/src/components/admin/CodexSection.tsx`
- `7da5cdd67` `beebox/src/core/todo/count.ts`, `beebox/src/core/agent-guide/todos.ts`
- `ea8e67884` `beebox/src/core/migration-sweep.ts`
- `98523aef7` `beebox/plugins/beebox-codex/scripts/run-bbx.sh`
- `777b1b0a8` `beebox/deploy/deploy.sh`
- `d09451cd6`, `2f5c50466`, `0d65810d0`: doctest-only

No bug in this window is traced to one of these landings. The hourly full-suite
run caught no regressions on `main`. The finding is structural: the gate does
not run on these paths.

## What would close it

This is a question of where the check lives. It does not require a new walk
step. Options for the session that takes this:

- Make `bin/land` run `bin/smoke` when the branch diff touches a deployed path.
  That covers schedules and any other caller in one place. The cost is the
  walk's disruption: it restarts the worktree's dev-server generation and
  needs the shared dev router to be up. An unattended schedule would then fail
  to land when the router is down.
- Add `bin/smoke` to each landing schedule's prompt, before `bin/land`. This is
  narrower, and each new landing schedule must remember to add it.

Direct commits on `main` are a process question (the main session is for small
tasks) more than a tier question. Record them here so a later review can see
whether they keep appearing.

## Evidence, second window (2026-09-30 review)

Window 2026-09-23T19:38Z to 2026-09-30T19:44Z, same method as above.

- 138 landings; 78 code landings; 57 walked; 21 not walked. The ratio is the
  same as the first window (38 of 53).
- Schedule merges with no walk: `worktree-sdk-update` 3 times (`7729ad98a`,
  `c0696536a`, `34f4e021f`, each `beebox/package.json` + `pnpm-lock.yaml`),
  and `worktree-supplemental-lint` once (`05a1f8bff`, which touches
  `beebox/src/frontend/src/router.tsx`).
- Direct commits on `main` with no walk: 14. Eight of them change frontend
  source, for example `dc231150e` (tRPC batch routing and retry),
  `f1bae4d9f` (unsent-message Discard), `342a2f6e9` (PDF view) and
  `097fdad30` (JSON file view). `8e1f945c1` is an Agent SDK bump made
  directly on `main`.
- The other two unwalked landings are a plan-doc-only merge (`b8a43d371`) and
  a tours-only merge (`c630f8075`). Both are exempt in practice.

No bug filed in this window is traced to an unwalked landing. The hourly
full-suite run caught no regressions on `main`.

## Evidence, third window (2026-10-07 review)

Window 2026-09-30T19:44Z to 2026-10-07T20:15Z. A landing counts as code when
its first-parent diff has a non-`.md` path that matches
`DEPLOYED_PATHS_PATTERN`. A merge counts as walked when
`beebox-smoke-log.jsonl` has a run on a commit in `P1..P2`.

- 132 landings; 49 code landings; 39 walked; 10 not walked. The walked share
  rose from about 72% to 80%. The schedule hole is unchanged.
- Schedule merges with no walk: `worktree-sdk-update` 4 times (`c25d0cd97`,
  `8068e3d33`, `1a9815f08`, `76cd3483a`, each `beebox/package.json` +
  `pnpm-lock.yaml`), and `worktree-knip-sweep` twice (`c256e9018` 2026-10-02
  and `65dc54d06` 2026-10-07, each with deletions across `beebox/src`).
- Direct commits on `main` with no walk: 2, down from 14. They are
  `36b161fe5` (JSONL splitting in session, scheduler and usage code) and
  `3af917740` (`bbx session --since`). Neither changes frontend source.
- The other two unwalked landings are a tours-only merge (`c0756ff73`) and a
  `beebox/deploy/deploy.sh`-only merge (`49e1adf18`).

No bug filed in this window is traced to an unwalked landing. The hourly
full-suite run caught no regressions on `main`.

## Evidence, fourth window (2026-10-14 review)

Window 2026-10-07T20:15Z to 2026-10-14T20:56Z. The counting rule is the same
as in the third window.

- 160 landings; 75 code landings; 57 walked; 18 not walked. The walked share
  fell from 80% to 76%.
- Schedule merges with no walk: `worktree-sdk-update` 4 times (`4e83ce1ca`,
  `8e1424f66`, `5c6438b21`, `3aa3c3aeb`, each `beebox/package.json` +
  `pnpm-lock.yaml`), `worktree-knip-sweep` once (`72e9b4ea3`, 15 files across
  `beebox/src/core`, `dev`, `frontend` and `plugins`), and
  `worktree-supplemental-lint` once (`c2f343f89`).
- Direct commits on `main` with no walk: 5, up from 2. Four change frontend
  source: `2ac8b9dc2` (archive label), `1f284170a` (chat recovery copy),
  `5faef0f50` (live gap marker), `76a74a4e7` (card properties copy). The
  fifth, `bf12905a4`, changes a TTS voice map in `beebox/src/core`.
- New this window: an interactive worktree landed frontend changes three times
  with no walk. `worktree-theme-polish` has one walk in the log, on `9cf67aac4`
  (2026-10-08 18:07 CDT). Its merges `22c4338fe` (18:41), `d6a3edf05` (18:57)
  and `c046d627f` (21:54) each bring later commits in `beebox/src/frontend`
  (27 files in the last one, including theme CSS and `app.tsx`). None of those
  commits has a walk. This review did not find which path the landings took.
  `bin/finish-verify` does not reuse an earlier smoke pass, so a landing
  through `/finish` would have walked.
- Other unwalked merges change only `beebox/src/dev`: `worktree-skills-review`
  twice (`b22fc811e`, `1e1bd4e65`), `worktree-test-oracles` (`412be4562`),
  and `worktree-agents-md` (`bee88d5d6`, which also changes `deploy.sh` and
  `beebox/src/core`).

No bug filed in this window is traced to an unwalked landing. The hourly
full-suite run caught no regressions on `main`.

## Evidence, fifth window (2026-10-21 review)

Window 2026-10-14T20:56Z to 2026-10-21T21:04Z. The counting rule is the same
as in the third window.

- 144 landings; 75 code landings. The rule finds 50 walked and 25 not walked.
- **The rule miscounts five of those 25.** The history of `main` from about
  2026-10-08 18:00 CDT to 2026-10-15 was rewritten. The backup refs
  `refs/backup/devprocess-talk-before-purge` and
  `refs/backup/devprocess-talk-before-squash` remain. 59 runs in
  `beebox-smoke-log.jsonl` (2026-10-08 to 2026-10-15) name commits that no
  longer exist. Five 2026-10-15 merges each have a green walk on their branch
  1 to 2 minutes before the merge, on a commit that the rewrite replaced:
  `e3764b15d` (busy-send-rejection), `02292aa44` (activity-detail),
  `6f5ee4d56` and `15daff865` (clerk-quick-send), and `7288c7906`
  (background-provider). With these five counted, 55 of 75 were walked (73%,
  down from 76%).
- The rewrite also breaks earlier evidence in this issue. `22c4338fe`,
  `d6a3edf05` and `c046d627f` (fourth window) and the fourth review's own
  landing, `22dd0d318`, no longer resolve. Find them by subject and date.
- **Largest unwalked landing:** `b28d11ae2` (`worktree-front-door`,
  2026-10-20), 16 commits and 103 deployed files, 46 of them in
  `beebox/src/frontend`. The log has no run on that branch.
- `worktree-ts7` twice with no walk: `36458a6ea` (47 files, including
  `beebox/deploy/deploy.sh`, `beebox/package.json` and `beebox/src/cli`) and
  `79b8665ed` (`beebox/src/scripts`).
- `worktree-theme-polish` again: `df255a11a` (2026-10-16 16:26 CDT, 11 files
  in `beebox/src/frontend` and `shared`) has no walk. The branch's next walks
  ran 6 hours later, on later commits.
- Schedule merges with no walk: `worktree-sdk-update` 4 times (`35578dec6`,
  `ec6be61c5`, `b389236f9`, `40b5f43ef`), `worktree-knip-sweep` once
  (`e93bbb83c`, 20 files across `cli`, `core`, `dev`, `frontend`), and
  `worktree-supplemental-lint` once (`9e722842b`, `beebox/src/webapp`).
- Direct commits on `main` with no walk: 8, up from 5. Three change frontend
  source: `f63b8278c` (remove nine themes, 20 files), `adbde2ced` (voice
  send phrase) and `d83140308` (chat send-tag pill). The others are
  `9e24c0fc5` and `345d354f9` (secret store, `beebox/src/hub` and `core`),
  `159fd6e36` (`deploy.sh`), `6f9e57dbf` (`beebox/src/shared`) and
  `939881165` (test helpers only).
- `worktree-doctest-typecheck` merges `d90468723` and `46aa2f6d8` have no walk
  on their own commits, but the branch has seven green walks on 2026-10-18.
  `46aa2f6d8` changes only test files.

No bug filed in this window is traced to an unwalked landing. The hourly
full-suite run caught no regressions on `main`.

## Evidence, sixth window (2026-11-18 review)

Window 2026-11-11T21:17Z to 2026-11-18T22:10Z. The counting rule is the same
as in the third window. The 2026-10-28, 2026-11-04 and 2026-11-11 reviews
added no section here.

- 150 landings; 76 code landings (63 merges, 13 direct commits); 47 walked;
  29 not walked. The walked share is 62%. This is the lowest share in the
  six recorded windows (72%, 73%, 80%, 76%, 73%).
- The smoke log has 52 runs in the window, all green.
- Schedule merges with no walk: `worktree-sdk-update` 3 times (`d5111b375`,
  `0c1ab7d1b`, `57b9db451`, each `beebox/package.json` + `pnpm-lock.yaml`),
  `worktree-knip-sweep` twice (`259873943`, 57 files; `4191dc6d0`, 45 files,
  both across `beebox/src`), and `worktree-supplemental-lint` once
  (`446e19c88`, 15 files in `beebox/src/cli`).
- Interactive worktree merges with no walk: 10.
  - `worktree-canvas-brushes` 4 times: `7d0de419d` (255 files, including
    `canvas-loop/package.json`), `d8e49619a`, `529a87745` (`deploy.sh`,
    `server-bin/bbx-box-install`) and `5d9f81568` (503 files). The log has 15
    runs on this branch, all on other commits. This is the same pattern as
    `worktree-theme-polish` in the fourth window.
  - `worktree-heic-upload` (`60da88b72`, 12 files, including
    `beebox/src/frontend/package.json` and the chat attachment code) and
    `worktree-direct-chat-load` (`07d50262d`, 6 files in the chat shell and
    conversation selection). The log has no run on either branch.
  - `worktree-homepage-questions` (`6ba715aaf`), `worktree-card-focus-space`
    (`9e9a2dd19`, theme CSS), `worktree-self-hosted-turn` (`0a9ef7137`,
    `deploy.sh`, coturn, `server-bin`) and `worktree-cross-box-leak-scan`
    (`45fd5613f`, `deploy.sh` only). Each branch has runs, but none on a
    commit in the merge.
- Direct commits on `main` with no walk: 13, up from 8. Three change frontend
  source: `4aafbbfb7` (attachment chip filename), `d45c74f22` (muted-speech
  probe, 4 files in `InteractiveChat`) and `ccf538f3d` (`FigureView`). The
  others are `c8e32a2f1` (`shared/model-ids.ts`), `b6e50e606` (transcription),
  `66e9011df` (`core/migrations.ts`), three box-browser commits (`1ac8445bc`,
  `061536dc7`, `c59425b7b`), two docs-gen commits (`742fdca15`,
  `464cdcdbb`), and two deploy commits (`6b85bd2ef`, `acab27c18`).

The interactive misses show that the hole is not limited to schedules and
direct commits. Branches that ran `/finish` at some point still land later
commits with no walk. Of the options under "What would close it", only a check
in `bin/land` covers this case.

No bug filed in this window is traced to an unwalked landing. The hourly
full-suite run caught no regressions on `main`.
