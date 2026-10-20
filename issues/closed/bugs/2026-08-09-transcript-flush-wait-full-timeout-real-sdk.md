---
title: "Transcript durability gate hits its full 5s timeout on both turns of a real-SDK doctest"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: weekly manual-test triage — 2026-08-09T151705Z run, repo 508f42cc
labels: [manual-tests]
priority: normal
resolution: implemented
---

Closed 2026-10-18: the gate polled the lexical tmp-box path while the CLI writes under the symlink-resolved path. Fixed in `bb68a237f` (transcript paths) and the follow-up that applies the same encoding to the memory link and the task-output check.

> **Naming note (2026-10-18):** doctests (`*.doctest.md`) are now `.test.ts` files with `t.check`, in the same directory under the same base name, and `agent-doctest` is now `tap-check/` (`@ianbicking/tap-check`). See `beebox/docs/implemented-plans/retire-doctest.md`.

`test/manual/chat-queue-real.test.ts` (real `claude` SDK process, not the
fake backend) logged the durability-gate warning from
`beebox/src/core/chat/session/run/transcript-sync.ts` on **both** of its two
turns:

```
[chat-session] transcript flush wait timed out for entry 49ccd9db-... (session 1900a730-...);
an immediate history fetch may miss the turn's final message
[chat-session] transcript flush wait timed out for entry cfa5b569-...(session 1900a730-...);
an immediate history fetch may miss the turn's final message
```

Full log: `logs/manual-tests/2026-08-09T151705Z-76179.log` (lines 35, 39). Exit
status 0 — the doctest still passed, because `waitForTranscriptEntry` is a
best-effort wait, not a gate the turn is failed on
(`transcript-sync.ts:58-60`).

Why this is suspicious rather than benign: `waitForTranscriptEntry` polls
every 30ms up to `WAIT_TIMEOUT_MS = 5_000`, and the file's own doc comment
says the measured CLI flush lag is ~150ms — "the cap only bites if the CLI
misbehaves." Two out of two turns running the full 5s bound (not landing
somewhere in between) is a ~33x miss on that assumption, and reads more like
"the entry is never found" than "the flush is just slow." This session was
root-bound (no landmark `contextDir`), so `resolveSessionLogPath` should
reduce to the plain `getSessionLogPath(boxRoot, sessionId)` path with no
lookup dependency — that rules out the most obvious path-mismatch
explanation, but wasn't traced further.

Candidates worth checking when this recurs:
- Whether the polled tail file genuinely never contains the `uuid`, or
  whether it does and the string match fails (e.g. real transcripts formatting
  the `uuid` key differently than the fixture-built ones in
  `chat-session-transcript-sync.doctest.md` assume).
- Whether this machine's load (concurrent Claude/Codex processes — see
  [run less of the test suite](../exploration/2026-08-08-run-less-of-the-test-suite.md)
  for the same environment's contention profile) is inflating the real CLI's
  flush latency well past 150ms, in which case the fix is a larger timeout or
  a different gating strategy, not a code bug.

This is the first logged run of the new weekly manual-test job (prior
`logs/manual-tests/launchd.log` is empty), so there's no baseline to say
whether this is new or has always been the case on this machine. Re-check
next week's log for recurrence before assuming a regression.

## 2026-08-16 recurrence

Same warning fired on both turns again, in the same doctest, still on exit
status 0 (test still passes). Run log:
`logs/manual-tests/2026-08-16T151700Z-53382.log` (lines 35, 39), repo
`39752043`. `WAIT_TIMEOUT_MS` is still 5s and the warning text is unchanged
in `beebox/src/core/chat/session/run/transcript-sync.ts:29,129`. Two
separate weekly runs, both two-for-two on the full timeout, rules out a
one-off fluke — this now looks like a standing condition on this machine
rather than an isolated slow poll. Still unconfirmed which of the two
candidate explanations above applies.

## 2026-08-23 recurrence

Third consecutive weekly run, same shape: warning on both turns of
`chat-queue-real.doctest.md`, exit status still 0. Run log:
`logs/manual-tests/2026-08-23T151704Z-74009.log` (lines 35, 39), repo
`b6171b95`. Entry UUIDs `e03a5ab0-51a6-49cc-9ea8-a1ef8fe97c04` and
`85dfeaf2-738a-4251-af2a-92607403b017`, session
`1a8b1b44-d384-4b56-9be0-fa42c49d0c30`. Three-for-three across three weeks
confirms this is a standing condition, not noise — still unconfirmed which
of the two candidate explanations above applies.

## 2026-09-01 recurrence

Same warning fired again on both turns of `chat-queue-real.doctest.md`
(itself still passing, exit 0). Run: commit `9550f5b68` on `main`, log
`~/src/schedule-runs/manual-tests/runs/20260901-192800.log`.
Session `59226045-43e6-470a-b59a-72aaf19f95ea`, entries
`47f8e82a-bbd8-473b-827f-74017ced05e9` and
`e77e9251-a8f4-4739-addf-f965c238a3db`. Still a standing condition; still
unconfirmed which of the two candidate explanations above applies.

## 2026-10-18 root cause found: wrong transcript path for a symlinked box root

Instrumented `waitForTranscriptEntry` and ran `chat-queue-real.test.ts` against
the real CLI. The wait polled
`~/.claude/projects/-var-folders-...-T-bbx-test-XXXX/<session>.jsonl`, a file
that never existed; the CLI wrote the transcript to
`~/.claude/projects/-private-var-folders-...-T-bbx-test-XXXX/<session>.jsonl`.
The CLI names the directory after its own `process.cwd()`, which the OS
reports with symlinks resolved, and on macOS `/var` links to `/private/var`.
beebox encoded the lexical box path. Neither slow flush nor uuid formatting
was involved.

Scope: the gate has never worked for a box whose root path passes through a
symlink (every macOS tmp test box). The same mismatch hit every transcript
lookup built on `getSessionDir`/`getSessionLogPath` (history reads, session
roots), not only the gate. Real boxes under `~/src/boxes/` and the worktree
test boxes resolve to themselves, so the gate has been working for them.

Fix: `getSessionDir`/`getSessionLogPath` in
`beebox/src/core/chat/session/transcript-paths.ts` now encode the realpath
of the cwd (a missing cwd resolves its nearest existing ancestor), as
`session/delete/apply/storage.ts` and the test runner already did. After the
fix the real-SDK test logs no warning and runs in ~6s instead of ~27s. New
test in `test/core/chat/session/run.transcript-sync.test.ts` seeds the
fixture at the encoded realpath of a box reached through a symlink (fails
without the fix). The old fixtures passed because they wrote through the
same helper the gate reads through.

Follow-up (same day): `symlinkClaudeMemory` (`core/box/structure/core.ts`)
now uses `getSessionDir`, and `isTaskOutputPathForBox` encodes the resolved
box root through the same private helper. The memory-symlink and task-output
route tests now build their fixtures at the resolved path; both fail without
the fix. The stray `-var-folders-*` directories in the real
`~/.claude/projects` are filed separately:
[stray test directories in the real Claude projects store](../code-quality/2026-10-18-stray-test-dirs-in-real-claude-projects.md).
A closed issue with the same root cause, fixed locally at the time:
[knowledge audit symlink cwd](2026-09-29-knowledge-audit-symlink-cwd-misses-claude-transcript.md).
