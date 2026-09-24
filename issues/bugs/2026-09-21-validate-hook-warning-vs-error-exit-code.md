---
title: "bbx validate --hook exits 2 for both warnings and real errors, so a harness that treats nonzero exit as failure reports a successful write as failed"
workstream: unattached
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

