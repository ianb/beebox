---
title: Claude knowledge audit crashes when the session log is absent
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-siri-app-intents — capture guidance knowledge audits
---

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
