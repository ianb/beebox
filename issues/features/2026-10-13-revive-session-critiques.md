---
title: "Revive session critiques: the grader no longer loads, and nothing runs it"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: human
discovered-in: worktree-devprocess-talk — reviewing the dev-process timeline, the developer said the tool should have stayed in use
---

Session critiques grade a box agent's session by whether the CLI served it:
`bbx session <id> --tool-report` writes a transcript that keeps the full output of
every Bash call, and a `@session-critique` subagent reads it and reports on five
points (ignored or misread output, raw git and grep where a `bbx` command should
exist, wrong tool, errors that caused flailing, wasted effort), each with a
concrete fix. See [session critiques](../../beebox/docs/testing/session-critiques.md)
and the closed build issue [session output critique tool](../closed/features/2026-03-04-session-output-critique-tool.md).

The report half still works: `--tool-report` is handled in
`beebox/src/cli/commands/session/modes.ts` and the extractor is
`beebox/src/dev/lib/session-report/report.ts`. The grading half is gone in
practice. The subagent is defined only in `beebox/.claude/agents.json`, the old
agent format, which current Claude Code does not load; the current format is a
Markdown file with frontmatter in `.claude/agents/` (see `.claude/agents/finish.md`).
The flag appears in 13 of the developer's transcripts, all early, and in none
since. The doc still tells a reader to type `@session-critique`, which does nothing.

The developer's note: the tool was useful and should have stayed in use. Knowledge
audits (what the agent knows) got a routine; critiques (whether the tools helped)
did not, and faded for lack of a trigger rather than for lack of value.

Tension: a tool that only runs when someone remembers it does not run. Reviving the
definition alone repeats the March outcome.

What a revival needs to decide:

- **The grader.** Port `agents.json` to `.claude/agents/session-critique.md` with
  the same five criteria and output format, and delete the old file. Or make it a
  skill that spawns a subagent, matching how `cross-model` review runs.
- **A trigger.** Options: a schedule (`bin/schedules`) that critiques the sessions
  since its last run and files findings as issues, like `alert-filing` does; or a
  step in `retrospective`, which already reads recent sessions every 3 days.
  Pick one; the doc's "after a session that seemed inefficient" trigger is the one
  that never fired.
- **Where findings go.** The 2026 queue is `issues/`, not `docs/ideas.md`, so each
  finding that names a `bbx` output or error-message change becomes an issue with
  the session id as evidence, deduplicated by `bin/issues search` first.
- **Scope of sessions.** Box-agent sessions were the original target; dev sessions
  in this repo use `bbx` less, and `bin/` scripts more, so the criteria may need a
  dev variant or the tool list widened.

Also fix the doc so it does not promise `@session-critique` until the grader exists.

Re-reviewed 2026-10-30: Still open. The --tool-report option is declared in beebox/src/cli/commands/session/command.ts:170.
