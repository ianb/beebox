---
title: "Mid-session context admission: when box state changes during a chat"
workstream: research-opencode
area: beebox
---

The system prompt is sent once at session creation (`src/services/claude-chat.ts`), and
everything after comes from the agent re-reading files. A card edited by a connector, a
schedule, or the boxholder in another surface mid-chat is invisible until the agent
happens to read it — and nothing in beebox names this or decides it.

OpenCode's `CONTEXT.md` names it. A **Context Source** is a typed value with a stable
key and pure renderers; the **Baseline System Context** is immutable for a **Context
Epoch** (so the provider cache prefix holds); when a source changes, the runtime emits a
**Mid-Conversation System Message** stating the newly effective state, admitted at the
next safe turn boundary, never rewriting the prefix, and "context source changes never
wake idle sessions."

beebox can't splice system messages — the Agent SDK owns the loop — but the shape
works above it: a next-turn preface listing box-state deltas since the last turn (cards
changed, questions answered, schedules run), derived from git or the event log, sized by
a budget. This is a firing point shared with the openclaw-hermes triage items on
session-rotation memory flush and open-loop extraction; the three want one "turn
boundary" seam.

Not to do: rewrite the prompt per turn (cache loss); wake idle sessions on change.

Source: [research/opencode/inspiration.md](../../research/opencode/inspiration.md).
