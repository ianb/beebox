# Session critiques

A real agent session, reviewed for whether the CLI tools served the agent.

## What it is

Report generator in `src/dev/lib/session-report.ts`; subagent in
`.claude/agents.json`.

Session critiques evaluate whether CLI tools helped or hindered the agent during real agentic sessions. Unlike knowledge audits (which test what the agent knows), session critiques test whether the tools the agent used gave it good output.

**When to use:** After observing a session with unusual behavior — the agent took too many turns, used raw git/grep instead of `bbx` commands, or seemed confused by command output. Also useful as a periodic check on CLI usability.

## How it works

1. **Report extraction:** `bbx session <id> --tool-report` parses the session JSONL and produces a markdown report containing:
   - User and assistant text messages
   - Bash commands with their **full output** (the key differentiator from `bbx session` which skips output)
   - Read/Write/Edit as one-liner summaries for context
   - Grep/Glob with abbreviated results

2. **Critique subagent:** The `@session-critique` agent reads the report and evaluates it against five criteria:
   - **Unhelpful output** — Did a `bbx` command produce output the agent ignored or misinterpreted?
   - **Missing commands** — Did the agent cobble together raw commands when a `bbx` command should have existed?
   - **Wrong tool** — Did the agent use the wrong tool (e.g., `Read` for scanning many files)?
   - **Bad error messages** — Did errors lead the agent to the fix or cause flailing?
   - **Wasted effort** — Retry loops, redundant reads, unnecessarily complex approaches?

3. **Output:** Structured findings with evidence, impact, and concrete suggestions (CLI format changes, new commands, `.claude/rules/` hints).

## Running it

```bash
# From within a box directory:
bbx session --list                   # find session IDs
bbx session <id> --tool-report       # generate report for a specific session
bbx session --latest --tool-report   # most recent session

# Or use the subagent (from Claude Code in this project):
# @session-critique <session-id>
# @session-critique latest
```

The subagent runs `bbx session` itself, so it needs a box directory context.

## Reading results

Session critiques produce actionable suggestions. The typical workflow:

1. **Run a critique** on a session that seemed inefficient or problematic.
2. **Review findings.** Each has a category and suggestion.
3. **For unhelpful-output:** Modify the `bbx` command's output format — trim noise, surface key info earlier, add structured markers the agent can parse.
4. **For missing-command:** Consider whether a new `bbx` subcommand or flag would help. Only add one if the pattern recurs across sessions.
5. **For wrong-tool:** Add a `.claude/rules/` hint that triggers when the agent is in the relevant context, pointing it to the right tool.
6. **For bad-error:** Improve the error message in the CLI command. Good errors name what went wrong, what file/card caused it, and what to do next.
7. **For wasted-effort:** Usually a prompting issue. Check if the system prompt or agent guide is missing guidance for this task type.

Not every session has problems. If the critique comes back clean, that's a positive signal that the tools are working.
