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

### Agent "give up" mechanism

Agent writes `.callback-box/agent-failure.json` with `{ reason, phase, sessionId }` to signal it can't complete. Caller detects, reverts uncommitted changes, logs failure. Prevents half-finished work from being committed.

### Chat assistant as job dispatcher

The chat frontend's system prompt should instruct the assistant to use jobs to start tasks rather than executing them synchronously. Also provide it with docs and CLI query tools to check: what's currently running, what's scheduled to run, when something last ran.

### Documentation graph — IMPLEMENTED

Implemented as `docs/doc-graph.md` (auto-generated cross-reference report). See CLAUDE.md Doc Map.

### Voice keyword for photo capture

Add a keyword trigger during voice input (especially the Clerk long recording mode) that captures a photo from the camera. Useful for annotating voice notes with visual context.

### Image card EXIF date extraction

When processing image cards, extract the date taken from EXIF data (DateTimeOriginal) rather than relying on file timestamps, which are unreliable after syncing/copying.

### Agent-editable UI text

The feedback confirmation messages ("Got it, I'll keep that in mind") feel like they come from a service, but they're actually queuing work for the agent. The agent can't directly respond in real-time, but it could edit a "translation file" of UI phrases to make them sound more like its own voice. This would let the agent personalize how the system communicates, even in places where it can't respond dynamically.

### Share-to-box for images and files

The iOS Shortcut share flow currently only handles URLs (opens a browser page with query params). For images, files, and plain text, the shortcut would need to POST data directly to an upload API endpoint using the "Get Contents of URL" action. The `cb create` command already supports `--attachment` and `--attachment-mimetype`, so the backend card creation works — what's needed is a simple HTTP upload endpoint (multipart POST → create card with attachment, no SSE). This would let the share shortcut accept any share sheet type, not just URLs.

### Per-user Google OAuth tokens

Currently Google connector tokens are stored per-box in a single `google.secret.json`. Any box user should be able to connect their own Google account. This means per-user token storage (e.g., keyed by email), knowing which user's tokens to use for which operations, and the OAuth callback tracking which user initiated the flow.
### Chat supplementary text — IMPLEMENTED

Updated `CHAT_SYSTEM_PROMPT` in `chat-session.ts` to describe two-channel output: `<speech>` tags for TTS, and markdown display text outside speech for visual details. Frontend already supported this (ReactMarkdown rendering + speech tag stripping).

### Session output critique tool — IMPLEMENTED

Implemented as `cb session <id> --tool-report` + `@session-critique` subagent. See `docs/testing.md` § Session Critiques for usage.
