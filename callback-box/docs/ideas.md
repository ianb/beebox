# Ideas & Planned Features

## Claude Code Memory Concerns

Auto-memory (`~/.claude/projects/<path-hash>/memory/`) is problematic:

- Path-hash-based and machine-specific -- not portable across machines
- Not version-controlled, easily lost if repo moves
- Custom subagents don't inherit CLAUDE.md or `.claude/rules/` (only built-in subagents do)
- No setting to relocate memory into the project repo
- Open feature request: [anthropics/claude-code#25739](https://github.com/anthropics/claude-code/issues/25739)

Durable project knowledge should go in repo files (CLAUDE.md, docs/), not auto-memory.

## Feature Ideas

### Calendar integration

Google Calendar sync via .ics files, CLI queries, potential cron via RRULE. Detailed plan in `docs/calendar-plan.md` (if it exists).

### Agent "give up" mechanism

Agent writes `.callback-box/agent-failure.json` with `{ reason, phase, sessionId }` to signal it can't complete. Caller detects, reverts uncommitted changes, logs failure. Prevents half-finished work from being committed.

### Chat assistant as job dispatcher

The chat frontend's system prompt should instruct the assistant to use jobs to start tasks rather than executing them synchronously. Also provide it with docs and CLI query tools to check: what's currently running, what's scheduled to run, when something last ran.

### Documentation graph

Build a graph of all docs (stack-decisions, testing-gaps, generated docs, CLAUDE.md files, memory files, etc.), detect orphans, visualize cross-references. Ensure no doc is unreachable and understand the reference structure.

### Voice keyword for photo capture

Add a keyword trigger during voice input (especially the Dropbox long recording mode) that captures a photo from the camera. Useful for annotating voice notes with visual context.

### Image card EXIF date extraction

When processing image cards, extract the date taken from EXIF data (DateTimeOriginal) rather than relying on file timestamps, which are unreliable after syncing/copying.

### Agent-editable UI text

The feedback confirmation messages ("Got it, I'll keep that in mind") feel like they come from a service, but they're actually queuing work for the agent. The agent can't directly respond in real-time, but it could edit a "translation file" of UI phrases to make them sound more like its own voice. This would let the agent personalize how the system communicates, even in places where it can't respond dynamically.

### Share-to-box for images and files

The iOS Shortcut share flow currently only handles URLs (opens a browser page with query params). For images, files, and plain text, the shortcut would need to POST data directly to an upload API endpoint using the "Get Contents of URL" action. The `cb create` command already supports `--attachment` and `--attachment-mimetype`, so the backend card creation works — what's needed is a simple HTTP upload endpoint (multipart POST → create card with attachment, no SSE). This would let the share shortcut accept any share sheet type, not just URLs.

### Jump into agent sessions from chat

The chat UI should let you view other active or recent agent sessions (e.g., the Telegram bot's session). A Telegram `/status` command (yes, Telegram bots support slash commands) could reply with a link like `https://box.example.com/<box>/chat?session=<sessionId>`. Opening that link would show the full session: tool calls, intermediate reasoning, file edits — all the stuff that doesn't fit in the Telegram message stream. This would make it much easier to debug or follow along with what the agent is doing in response to Telegram messages.

### Per-user Google OAuth tokens

Currently Google connector tokens are stored per-box in a single `google.secret.json`. Any box user should be able to connect their own Google account. This means per-user token storage (e.g., keyed by email), knowing which user's tokens to use for which operations, and the OAuth callback tracking which user initiated the flow.
### Session output critique tool

A tool that extracts all command-line output from a Claude Code session, then a separate agent critiques it: which output was useful, which was long-winded, incomplete, or misdirecting. Useful for improving agent behavior and identifying patterns where the agent wastes time or goes in circles.
