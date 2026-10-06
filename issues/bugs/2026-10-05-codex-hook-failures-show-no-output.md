---
title: "Codex sessions report \"hook failed, exit code 1\" with no output the agent can see"
workstream: unattached
area: dev-tooling
labels: [codex]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder saw it in Codex dev-session transcripts
---

Codex sessions in this repo show "hook failed, exit code 1". The agent
cannot see the hook's output, so it cannot fix the cause. Example: the
`secret-field-masking` session (rollout
`2026-10-05T18-52-33-01a10e7b…`) was asked why its hook failed, and answered
that it had no output from the hook. The hook may be reporting a real problem,
such as a validation failure, in a form Codex drops.

This issue is about dev sessions. Also check whether box sessions (box agents
running on Codex, with the box's own validation hooks) have the same problem.

## Findings so far (2026-10-05)

- Codex runs two hook sets in a dev worktree:
  - The generated project hook `<worktree>/.codex/hooks.json`, written by
    `bin/generate-agents-md.ts`: PostToolUse on `apply_patch|Edit|Write` runs
    `vibe-check lint --hook` (`personal-vibe-check/bin/vibe-check.ts:34-98`).
  - The global `~/.codex/hooks.json`: Stop runs `~/.claude/hooks/notify.sh`
    and Adrafinil `release`; UserPromptSubmit and SubagentStart/Stop run
    Adrafinil `acquire`/`release`.
- Run by hand with sample payloads, every one of them exits 0.
- `vibe-check lint --hook` is written for Claude Code's payload: it reads
  `tool_input.file_path` and exits 0 when it is missing. A Codex
  `apply_patch` payload probably carries the patch, not a `file_path`. If so,
  the lint hook silently lints nothing under Codex, which is a second bug.
  Verify with a real Codex payload.
- In the example, the edit that preceded the failure was to
  `beebox/docs/security-report.md`, which the lint hook skips. So a different
  hook, or the lint hook on a different file, failed.
- Codex's log (`~/.codex/logs_2.sqlite`, table `logs`) shows two hooks
  started at 23:56:56 and completed at 23:56:59 UTC in that turn, but records
  no command, exit status, or output for them.

## To investigate

1. Capture the real hook payloads and results. Wrap each hook command so it
   tees stdin, stdout, stderr, and the exit status to a file, then reproduce
   in a Codex session (edit a `.ts` file with a lint error, edit a `.md` file,
   end a turn).
2. Find the hook that exits 1, and why.
3. Find what Codex does with a hook's stdout, stderr, and exit status, and
   what it passes to the model (Codex's hook protocol may differ from Claude
   Code's `hookSpecificOutput.additionalContext` and exit-2 convention). Make
   our hooks report to Codex in a form the model sees, or document that it
   cannot.
4. Make the lint hook understand Codex `apply_patch` payloads (the files the
   patch touches).
5. Repeat for box sessions on Codex.
