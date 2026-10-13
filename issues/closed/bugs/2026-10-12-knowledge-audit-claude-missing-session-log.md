---
title: Claude knowledge audit crashes when the session log is absent
workstream: siri-app-intents
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-siri-app-intents — capture guidance knowledge audits
---

Resolved on 2026-10-12: the audit runner invokes Claude and collects its
transcript with a canonical physical working directory. Symbolic-link
collection and absent-transcript regressions pass. A genuinely missing
transcript produces a session/path diagnostic and a nonzero CLI exit before
checks are evaluated. No empty successful observation is substituted.

The real Claude Siri audit run completed all six audits on a synthetic `/tmp`
box and wrote its report. Four passed automated checks; two had wording-only
mismatches ("input from a person ... request to the whole box" and "Siri doesn't
read the box's reply aloud"). Inspection confirmed the intended behavior in
both responses. This verifies collection, not physical iPhone behavior.


A Claude knowledge audit crashed before producing a report on a fresh synthetic
box outside the repository. The collector attempted to open
`~/.claude/projects/<encoded-box-path>/<session-id>.jsonl` and received `ENOENT`.
The CLI exited with an unhandled rejection instead of recording a failed audit
with the missing-log diagnostic. No authentication error was reported.

## Reproduction (2026-10-12)

Initialize a standalone synthetic box with `bbx engine init`, then run from
`beebox/`:

```bash
pnpm knowledge-audit run --box /tmp/bbx-siri-capture-audit-20261012 --filter siri-app-intents --engine claude
```

The run regenerated guidance, began `external-input-arrival-tag`, then crashed
while opening the Claude session JSONL. The same five audits completed using
`--engine codex`; all automated checks passed. This isolates the observed failure
to the Claude collection path, but does not establish why its log was absent.

The operator used scoped `BBX_AUTH_FILE` and `BBX_SECRETS_FILE` for the synthetic
box and kept the normal agent login environment. No credential changes were made.

## Code pointers

`beebox/src/dev/lib/test-runner/runner/run-test.ts:205` computes the session log
path and calls `parseSessionLog`; the missing file rejection escapes the runner.
`beebox/src/dev/knowledge-audit.ts` owns the audit CLI and report generation.

Investigate whether the engine stopped before writing a log, wrote somewhere
else, or whether collection raced its availability. Preserve the actionable
error in the audit report instead of claiming that the test passed.
