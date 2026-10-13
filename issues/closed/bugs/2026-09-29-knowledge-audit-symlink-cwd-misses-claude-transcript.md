---
title: "Knowledge audit misses Claude transcripts when its box path uses a symlink"
workstream: siri-app-intents
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-jev-triage — auditing destination todo guidance
priority: normal
---

Resolved in `cc8aeeac7` on 2026-10-12: the audit runner invokes Claude and collects its
transcript with a canonical physical working directory. Symbolic-link
collection and absent-transcript regressions pass. A genuinely missing
transcript produces a session/path diagnostic and a nonzero CLI exit before
checks are evaluated. No empty successful observation is substituted.

The real Claude Siri audit run completed all six audits on a synthetic `/tmp`
box and wrote its report. Four passed automated checks; two had wording-only
mismatches ("input from a person ... request to the whole box" and "Siri doesn't
read the box's reply aloud"). Inspection confirmed the intended behavior in
both responses. This verifies collection, not physical iPhone behavior.


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
