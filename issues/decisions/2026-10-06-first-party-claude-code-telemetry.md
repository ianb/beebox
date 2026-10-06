---
title: "Decide whether first-party agent runs should turn off Claude Code's own telemetry"
workstream: unattached
needs: [decision]
area: beebox
labels: [security, providers]
filed-by: agent
discovered-by: agent
discovered-in: worktree-third-party-engine-privacy — checking what Claude Code sends besides model requests
---

Beebox's own code sends no telemetry. The Claude Code subprocess that runs
every agent turn does: usage metrics to Anthropic and Anthropic's logging
vendor, and, for Pro/Max subscription sign-ins, redacted error reports to an
error-tracking service (code.claude.com/docs/en/data-usage). The security
report and README used to say "no telemetry of any kind"; that claim covered
only beebox's code.

Runs on third-party models (OpenRouter, GLM) now set `DISABLE_TELEMETRY`,
`DISABLE_ERROR_REPORTING`, and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
(`beebox/src/core/provider-env/core.ts`). First-party runs pass the first two
through only when the host environment sets them
(`beebox/src/hub/supervisor/child-env.ts`, `beebox/src/core/script-env/allowlist.ts`);
the deploy sets neither.

The decision: set them for first-party runs too, or accept the current
behavior. For: the report could say "no telemetry" again, and error reports
go to a vendor other than Anthropic. Against: Anthropic documents the metrics
as excluding code, prompts, and file paths, and Anthropic already receives the
full context of these runs. `DISABLE_TELEMETRY` also turns off Claude Code's
feature-flag fetch, which some CLI features need. `DISABLE_ERROR_REPORTING`
does not.
