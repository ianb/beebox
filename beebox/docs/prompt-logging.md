# Prompt Logging for Agent Invocations

When agents run in a beebox (via `bbx wakeup`, `bbx reactor`, procedures, etc.), you can capture the full API traffic — including system prompts, CLAUDE.md content, and all context that Claude Code sends to the API.

This is useful for:
- Verifying that generated documentation (`agent-guide.md`, card rules) is actually loaded
- Debugging agent behavior by seeing exactly what context it received
- Auditing what files and instructions were included in the system prompt

## Enabling Prompt Logging

Set `BBX_LOG_PROMPTS=1` before running any agent command:

```bash
# For a single command
BBX_LOG_PROMPTS=1 bbx wakeup

# Or export for a whole session
export BBX_LOG_PROMPTS=1
bbx wakeup
bbx reactor
```

Logs are written to `.beebox/logs/<session-id>.log` (gitignored).

## How It Works

When `BBX_LOG_PROMPTS=1` is set, each agent invocation:

1. Starts a local [claude-code-logger](https://github.com/dreampulse/claude-code-logger) proxy on a random port
2. Routes the Claude API traffic through the proxy via `ANTHROPIC_BASE_URL`
3. Captures the proxy's output (full prompts, responses) to a log file
4. Shuts down the proxy when the agent exits

The proxy is transparent — it forwards all requests to `api.anthropic.com` unchanged and logs what passes through.

## Reading Logs

Each log file has a header with the session ID and timestamp, followed by the full API traffic.

### The system prompt section

The most useful part is the system prompt, which shows everything Claude Code loaded. Look for the `📋 System Reminder:` marker:

```bash
# View just the system prompt section (everything between 📋 and 👤)
sed -n '/📋 System Reminder/,/👤/p' .beebox/logs/<session-id>.log
```

In the system prompt you'll see blocks like:

```
Contents of /path/to/boxes/test1/CLAUDE.md (project instructions):

@.beebox/agent-guide.md


Contents of /path/to/boxes/test1/.beebox/agent-guide.md (project instructions):

# Bee Box Agent Guide
...

Contents of /path/to/boxes/test1/.claude/rules/card-question.md (project instructions):

# Handling Questions
...
```

This confirms which CLAUDE.md files, @-includes, and `.claude/rules/` files were loaded.

### List all loaded files

```bash
# Extract the "Contents of ..." headers to see which files were loaded
grep "^Contents of " .beebox/logs/<session-id>.log
```

Example output:
```
Contents of /Users/.../CLAUDE.md (project instructions, checked into the codebase):
Contents of /Users/.../THINKING_CLAUDE.md (project instructions, checked into the codebase):
Contents of /Users/.../boxes/test1/CLAUDE.md (project instructions, checked into the codebase):
Contents of /Users/.../boxes/test1/.beebox/agent-guide.md (project instructions, checked into the codebase):
Contents of /Users/.../boxes/test1/.claude/rules/card-procedure.md (project instructions, checked into the codebase):
Contents of /Users/.../boxes/test1/.claude/rules/card-question.md (project instructions, checked into the codebase):
...
```

### Check if a specific doc was loaded

```bash
# Was the agent guide loaded?
grep -c "Bee Box Agent Guide" .beebox/logs/<session-id>.log

# Was the question card rule loaded?
grep -c "Handling Questions" .beebox/logs/<session-id>.log

# Was a specific capability mentioned?
grep "open-tab" .beebox/logs/<session-id>.log
```

### DOCID markers for quick verification

Enable DOCID markers to embed unique identifiers in every generated doc:

```bash
bbx init . --docid-debug
```

This persists a marker file at `.beebox/docid-debug`. Once set, all subsequent doc generation (including `bbx wakeup` and plain `bbx init .`) will include the markers automatically. Disable with `bbx init . --no-docid-debug`.

Each generated doc gets an HTML comment like `<!-- DOCID:.beebox/agent-guide.md -->` at the top, using the file's path relative to the box root. These are easy to find in prompt logs:

```bash
# Run an agent with logging
BBX_LOG_PROMPTS=1 bbx wakeup

# Check which generated docs made it into the prompt
LATEST=$(ls -t .beebox/logs/*.log | head -1)
grep "DOCID:" "$LATEST"
```

Example output:
```
<!-- DOCID:.beebox/agent-guide.md -->
```

If a DOCID is missing, that doc wasn't included in the agent's context.

Available markers:
- `DOCID:.beebox/agent-guide.md` — the always-loaded agent guide (@-included in CLAUDE.md)
- `DOCID:_content/docs/generated/bbx-commands.md` — bbx command reference
- `DOCID:_content/docs/generated/connectors.md` — connector capabilities
- `DOCID:_content/docs/generated/card-memo.md`, `DOCID:_content/docs/generated/card-question.md`, etc. — per-card-type docs

### Find the latest log

```bash
# Most recent log file
ls -t .beebox/logs/*.log | head -1

# View the system prompt from the latest run
LATEST=$(ls -t .beebox/logs/*.log | head -1)
sed -n '/📋 System Reminder/,/👤/p' "$LATEST"
```

### View the user prompt

The user prompt appears after the `👤` marker at the end of the system prompt section:

```bash
# Show what the agent was asked to do
grep "^👤" .beebox/logs/<session-id>.log
```

## Session JSONL Files

Claude Code also writes session transcripts to `~/.claude/projects/<encoded-path>/<session-id>.jsonl`. These contain the conversation messages (user prompts, assistant responses, tool calls) but NOT the system prompt.

To inspect these:

```bash
# Find the JSONL for a session
find ~/.claude/projects -name "<session-id>.jsonl"

# View conversation flow
jq -r '.type' ~/.claude/projects/.../<session-id>.jsonl

# See the user message
jq -r 'select(.type == "user") | .message.content' ~/.claude/projects/.../<session-id>.jsonl

# See assistant response text
jq -r 'select(.type == "assistant") | .message.content[] | select(.type == "text") | .text' ~/.claude/projects/.../<session-id>.jsonl

# See tool calls made
jq -r 'select(.type == "assistant") | .message.content[] | select(.type == "tool_use") | {tool: .name, input_preview: (.input | tostring | .[0:100])}' ~/.claude/projects/.../<session-id>.jsonl

# Token usage
jq -r 'select(.type == "assistant") | .message.usage' ~/.claude/projects/.../<session-id>.jsonl
```

## Correlating Sessions

Each agent invocation gets a unique session ID (UUID). This ID appears in:
- The log filename: `.beebox/logs/<session-id>.log`
- The JSONL filename: `~/.claude/projects/.../<session-id>.jsonl`
- Git commit trailers: `Session: <session-id>`

To find all artifacts for a session:

```bash
SESSION=e61bf366-a02c-424d-b418-995c279caf97

# Prompt log
cat .beebox/logs/$SESSION.log

# Conversation transcript
find ~/.claude -name "$SESSION.jsonl" -exec jq '.' {} \;

# Git commits from this session
git log --all --grep="Session: $SESSION"
```

## Performance Note

The logging proxy adds minimal latency (~1-2ms per request). The main cost is disk space for the log files, which can be large for multi-turn agent sessions. Clean up old logs with:

```bash
# Remove logs older than 7 days
find .beebox/logs -name "*.log" -mtime +7 -delete
```
