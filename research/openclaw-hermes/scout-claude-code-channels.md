# Claude Code Channels — official Anthropic channel ingress (research preview)

*Scouted 2026-07-04. Not a competitor: a platform feature of the harness bbx already rents. Anthropic research preview, March 2026, Claude Code v2.1.80+; sources: code.claude.com/docs/en/channels + channels-reference, plugin sources in anthropics/claude-plugins-official.*

## What it is

A **channel is an MCP server that pushes events into a running Claude Code session**. Claude Code spawns it over stdio; the server declares `capabilities.experimental['claude/channel']: {}` and emits `notifications/claude/channel` with `{content, meta}`; the event lands in the live session as:

```
<channel source="webhook" chat_id="7" severity="high">build failed on main: …</channel>
```

(`source` set automatically from the server name; each `meta` key becomes a tag attribute; keys with hyphens silently dropped.) The server's `instructions` string is added to the system prompt to tell Claude how to treat events. Two-way channels expose an ordinary MCP `reply` tool. Official plugins: **Telegram, Discord, iMessage** (+ fakechat demo); enabled per session via `claude --channels plugin:telegram@claude-plugins-official`.

Key semantics:
- **Session-bound**: events only arrive while a session is open; always-on = run Claude in a persistent process. Positioning vs siblings: cloud-session spawners (Claude Code on the web, Slack), pull-only MCP, Remote Control (drive a session) — channels are the only *push into an existing local session*.
- **Delivery**: notifications unacknowledged; silently dropped if the channel isn't registered or org policy blocks; events queue while Claude is busy and are **delivered as a group on the next turn**; concurrent independent streams ⇒ separate sessions.
- **Access control**: per-sender allowlist bootstrapped by pairing codes (`/telegram:access pair <code>`, then `policy allowlist`); docs explicitly warn to gate on *sender* id, not room id. Being in `.mcp.json` is not enough — the server must also be named in `--channels`. Org-level `channelsEnabled` + `allowedChannelPlugins` managed settings.
- **Permission relay** (v2.1.81+): a channel declaring `claude/channel/permission` receives `notifications/claude/channel/permission_request` `{request_id (5 lowercase letters, no 'l'), tool_name, description, input_preview (≤200 chars JSON)}`; the human replies "yes <id>"/"no <id>" in chat; server emits `notifications/claude/channel/permission` `{request_id, behavior: allow|deny}`. Local terminal dialog stays live in parallel — first answer wins. Non-interactive `-p` mode disables terminal-input tools so sessions never stall.
- **Research-preview constraint**: custom channels require `--dangerously-load-development-channels server:<name>` (per-entry bypass); the production allowlist is Anthropic-curated; community marketplace is NOT on it.

## Why this matters for bbx (more than any competitor finding)

1. **Chat ingress may be a platform feature, not a connector we build.** Our Telegram connector is an unused placeholder (boxholder, 2026-07-04); if/when real chat ingress matters, an official, maintained, paired/allowlisted Telegram/Discord/iMessage bridge exists *inside the harness we already run*. The build-your-own contract is ~100 lines of TypeScript for a custom channel (e.g. a beebox-clerk channel, a webhook channel for connectors).
2. **Permission relay ≈ question-cards-as-approvals.** The channel-affordances dive found approval flows are the one structural cousin of question cards in chat-first systems; here the pattern is *native to our platform*, with the id-echo verdict protocol already designed (5-letter phone-typeable ids, autocorrect tolerance, first-answer-wins).
3. **Tension to resolve: channels are chat-first by construction.** Events arrive as transient `<channel>` context in one long-running session — the opposite of our card-materializing ingest and per-thread reactor sessions. A bbx adoption would need to decide: (a) channel events land in a dedicated always-on session whose job is to *write cards* (ingress adapter, keeps cards-first); (b) channels power only the interactive-chat surface while connectors keep doing ingest; or (c) not yet — research preview, flag syntax and protocol may change, and our web chat remains the filled-out surface.
4. **Convergent details worth noting**: `<channel source=…>` tagging is source-attributed content wrapping (the untrusted-wrapping pattern, minus randomized boundaries); pairing-code + sender-allowlist is exactly OpenClaw/Hermes DM pairing; group-delivery-on-next-turn is OpenClaw's debounced batching.

## Open questions for a bbx evaluation

- Does the Agent SDK expose `--channels` (or will it)? The reactor/chat sessions are SDK-spawned; channels are documented CLI-side.
- Session lifetime economics: an always-on channel session vs our idle-shutdown model.
- Whether the queued-group delivery semantics fit reminder/wakeup delivery (attach-to-session, triage row 9).
