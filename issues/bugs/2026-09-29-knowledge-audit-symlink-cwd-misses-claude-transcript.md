---
title: "Knowledge audit misses Claude transcripts when its box path uses a symlink"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-jev-triage — auditing destination todo guidance
priority: normal
---

A Claude knowledge audit against a disposable synthetic box under `/tmp/`
completed its model run but failed with ENOENT while opening the transcript.
On macOS that path resolves under `/private/tmp/`. The expected transcript
existed under the encoded real path, not the encoded invocation path.

The failure is in transcript collection, not in the new triage guidance.
The same focused audit passed with Codex on a clean synthetic box. No real
box was used or modified.

## Research (2026-09-29)

- `beebox/src/dev/lib/test-runner/runner.ts:171` passes the invocation cwd to
  `extractBehavior`, which uses `getSessionLogPath` at line 196.
- `beebox/src/core/chat/session/transcript-paths.ts:34` encodes the supplied
  string; `getSessionLogPath` does not resolve filesystem symlinks.
- A read-only existence check found the failed run's exact session ID under
  the encoded `/private/tmp/` project directory. Its `/tmp/` counterpart was
  the ENOENT path in the audit failure.

Use a canonical real path for the audit invocation/lookup, or narrowly support
both paths. Do not change the pure encoder globally without checking its other
callers. Add a symlink-root audit transcript regression. This remains separate
from the triage todo feature.
