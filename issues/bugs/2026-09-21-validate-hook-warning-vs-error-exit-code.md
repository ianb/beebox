---
title: "bbx validate --hook exits 2 for both warnings and real errors, so a harness that treats nonzero exit as failure reports a successful write as failed"
workstream: validate-hook-channels
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
priority: important
---

`bbx validate --hook` (`beebox/src/cli/commands/validate-hook.ts`) is wired as
the agent harness's PostToolUse hook (`beebox/docs/card-validation.md:13`):
the file write has already happened by the time this hook runs. Its own
comment says: "Non-card paths exit 0 silently; errors AND warnings exit 2 so
the agent sees feedback" (`validate-hook.ts:206-207`), and `runHookMode`
(`validate-hook.ts:210-221`) does exactly that — any non-null feedback, error
or warning, is written to stderr and the process exits 2.

One concrete warning-only path: editing a box's `CLAUDE.md` past the soft
size threshold returns `{ feedback: <warning text>, hasErrors: false }`
(`validate-hook.ts:154`, via `lintClaudeMdFile`,
`beebox/src/core/claude-md-lint.ts`), which is explicitly documented as "never
a hard error and never a commit block" (`claude-md-lint.ts:14`). The exit code
does not carry the `hasErrors` distinction the code already computed — it is
discarded before `process.exit(2)`.

Two feedback reports from the same box are consistent with this: one where
an agent apply-patch tool reported "Script failed" for a `CLAUDE.md` edit that
had, on inspection, actually been applied; and one where an agent concluded a
one-paragraph `CLAUDE.md` correction "could not be saved" past the size
threshold and instead performed an unrelated large refactor to work around a
block that, per this code path, does not exist — the edit already succeeded
before the hook ran.

## Suggested direction

Surface the already-computed `hasErrors` bit through the hook's exit code
(e.g. exit 2 only when `hasErrors` is true, exit 0 with stderr feedback for a
warning-only result), so a harness that treats "nonzero = the operation
failed" doesn't misreport a completed write as failed.

## Why resolution is not obvious

Some harnesses may rely on exit 2 specifically to guarantee the agent reads
the stderr feedback at all (a 0 exit with stderr output may be ignored by a
harness that only surfaces feedback on failure). Changing the exit code for
warnings could silence exactly the nudges this hook exists to deliver,
depending on how each connected harness (Claude Code, Codex apply_patch,
others) treats exit 0 with stderr. This needs checking against each harness's
actual behavior, not just the hook's own contract.

## Discussion (2026-09-24)

Boxholder's disposition:

- Earlier Claude Code experiments showed that a warning is ignored entirely
  without exit 2 (stderr on exit 0 did not reach the model). So plain exit 0
  with stderr is out.
- If exit 0 plus JSON on stdout (`hookSpecificOutput.additionalContext`)
  does reach the model, use it for warnings. Prove it with an experiment first.
- Codex's behavior is unknown. Establish it by experiment.
- Persistent warnings are a problem in their own right: the same warning
  (for example, CLAUDE.md over its soft size limit) fires on every edit.
  Repeats should be suppressed in some way.

## Research (2026-09-24)

I ran real one-turn agent sessions with a throwaway `PostToolUse` command hook.
Each hook consumed its stdin, logged that it ran, and emitted a unique marker;
the agent edited `target.txt` from `original` to `changed` and then reported
what it saw. Every counted run had a matching hook invocation and the file was
`changed` afterward. Claude Code used `claude -p` with a temporary settings
file and `Edit`; Codex used the workspace's pinned `node_modules/.bin/codex`
0.155.1 with a temporary project hook and `apply_patch`. Each channel was
tested twice, with a fresh target file and marker each time.

| Harness | Hook output | Marker reached model | Edit reported failed? |
| --- | --- | --- | --- |
| Claude Code | exit 0, stderr | No (0/2) | No (0/2) |
| Claude Code | exit 0, JSON `hookSpecificOutput.additionalContext` on stdout | Yes (2/2) | No (0/2) |
| Claude Code | exit 2, stderr | Yes (2/2) | Edit tool reported success, followed by a blocking hook error (2/2) |
| Codex 0.155.1 | exit 0, stderr | No (0/2) | No (0/2) |
| Codex 0.155.1 | exit 0, JSON `hookSpecificOutput.additionalContext` on stdout | Yes (2/2) | No (0/2) |
| Codex 0.155.1 | exit 2, stderr | Yes (2/2) | Yes (2/2), although the file had changed |

The JSON was `{"hookSpecificOutput":{"hookEventName":"PostToolUse",
"additionalContext":"<marker>: informational warning"}}`. Codex's
[hook documentation](https://learn.chatgpt.com/docs/hooks) specifies that
`PostToolUse` JSON `additionalContext` becomes model-visible developer context,
while exit 2 replaces or rejects the completed tool result. The real runs
confirmed that contract for this pinned binary. The first two Codex attempts
were excluded because the throwaway hook never fired; removing
`--ignore-user-config` let the project hook load. The later runs all had hook
invocation logs.

**Implementation consequence:** warning-only results can use exit 0 with JSON
`additionalContext` in both harnesses. Results containing real errors should
keep exit 2 and stderr. Neither harness delivered plain stderr on exit 0.

## Repeat suppression (approved 2026-09-24)

Suppress the recurring `CLAUDE.md` size warning once per agent session and
file. Both harnesses include `session_id` in the hook input. Keep a small cache
under the box's gitignored `.beebox/` runtime directory, keyed by session ID,
file path, and the soft/firm size tier. The first warning in a tier reaches the
agent. Later edits in the same tier stay quiet. Crossing into the firm tier
warns again. An edit that brings the file below the threshold clears that
file's entry, so a later oversized edit warns again. Cap or expire old session
entries. If the session ID is absent or the cache fails, deliver the warning
rather than silently losing it. Other validation warnings remain unchanged in
this first pass.

This design prevents every small character-count change from producing a new
warning. It also gives a new agent session its own notice about an existing
oversized file. The boxholder chose this design. The first implementation
applies it to `CLAUDE.md` size warnings; other warning classes still run on
every relevant edit.
