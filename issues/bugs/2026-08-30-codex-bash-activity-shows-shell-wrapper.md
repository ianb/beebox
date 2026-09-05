---
title: "Codex bash activity renders its shell wrapper where Claude's doesn't — command lines read noisier on codex chats"
workstream: unattached
area: beebox
labels: [chat, codex, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "Codex always seems to show bash in its bash calls, in a way Claude doesn't. Not a big deal"
priority: backlog
---

On codex-engine chats, command activity lines show the shell machinery —
`bash -lc '…'`-style wrappers — where Claude-engine chats show just the
command. Same normalized surface (`codexSdkToolChatMessage` maps a Codex
`command_execution` item to a `Bash` tool_use with `input.command` verbatim,
`src/services/codex-tool-activity.ts:97-101`), so the difference is upstream
content: Codex's `command` field carries its own invocation wrapper, Claude's
harness reports the command it ran.

Look at:

- What Codex's item actually contains (a rollout sample will show whether it's
  literally `bash -lc "<cmd>"` or an argv array we're joining).
- Whether to strip the wrapper at the normalization boundary
  (`normalizeCodexSdkToolItem` and its sibling in
  `core/chat/session/codex-transcript.ts` — both paths must agree) — a
  conservative unwrap of the common `bash -lc <one-arg>` shape, showing the
  inner command, falling back to verbatim for anything else. Same for the
  activity summary line the collapsed group shows.
- Cosmetic only — never alter what's recorded, just what renders.

Low priority per the boxholder; a candidate for a future small-bugs batch.
