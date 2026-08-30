---
title: "MCP tool: agent launches the conversation into another chat (by landmark or specific chat), carrying context"
workstream: unknown
needs: [design]
area: beebox
filed-by: agent
discovered-in: main session — boxholder's idea
priority: normal
---

An **MCP tool the box agent can call** to hand the live conversation off into a
**different chat**, carrying context. The tool jumps the user into the target
chat, seeds it with a message, and the **UI redirects there**.

Targets:
- **By landmark** — then either its **most-recent chat** or a **new chat** under
  that landmark.
- Or **a specifically identified chat** (by id).

The tool accepts **context** that is delivered as a **message in the destination
chat** (which kicks off that chat's turn), and the **frontend then redirects** the
user to that chat.

## Why MCP (the boxholder's reasoning)

This is a **hard breakpoint in the conversation** — the current chat's turn hands
off and the client navigates away. That termination-and-redirect shape is why it
belongs as an MCP tool the agent invokes (the tool result carries the redirect
directive the client acts on), rather than inline agent behavior.

## Primary use case, and beyond

The motivating case is **create-a-new-landmark-then-launch-into-it**: the agent
creates a landmark and immediately drops the user into its chat with seeding
context. But the tool is more general — routing a conversation into the chat where
it actually belongs (an existing landmark's recent chat, or a specific chat) is
useful in other flows too.

## The goal it serves

When the agent decides this conversation belongs somewhere else — a just-created
landmark, or a more appropriate existing chat — the user should be **carried there
with the context intact** and continue seamlessly in the right place, rather than
being told "go start a chat over there" and losing the thread.

## Design questions

- **Target API.** How is the destination named — `{ landmark, mode: "recent" |
  "new" }` vs. `{ chatId }`? One tool with a union, or clear separate shapes.
- **Message provenance.** The seeded context — is it delivered as a *user*
  message, an *agent/system handoff* block, or a dedicated handoff kind? This
  decides how the destination agent treats it and whether it auto-runs a turn.
  (See `docs/chat-session-lifecycle.md`.)
- **The redirect channel.** How does an MCP tool call cause the chat UI to
  navigate? The tool returns a directive; the client must interpret it and route
  to the target chat. Needs a defined "navigate to chat X" signal from the
  tool-result path back to the frontend.
- **Landmark → which chat.** "Most recent or new" — a parameter the agent sets,
  or a rule? And how a *new* chat under a landmark is created and addressed.
- **Create-then-launch coupling.** Is landmark creation part of this tool, or a
  separate step whose result (the new landmark) is passed to a launch call? Likely
  separate (create, then launch-into the new landmark) — keeps the tool single-
  purpose.
- **Breakpoint semantics.** Does the current turn finish its response before
  redirecting? Is the handoff one-way (no return)? What becomes of the origin chat
  — does it persist as-is, or is it marked handed-off?

## Related

- [Landmarks](../../beebox/docs/landmarks.md) — the navigation surface the
  "by landmark" target rides on.
- [Chat session lifecycle](../../beebox/docs/chat-session-lifecycle.md) — how
  a chat/turn starts, which the seeded message would trigger.
- Memory Atlas architecture review (`research/memory-atlas-architecture-review.md`)
  — the feature set this belongs to.
</content>
