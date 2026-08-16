---
title: "Write-only secret capture in chat — model requests a token, never sees the value"
workstream: unknown
needs: [design]
filed-by: agent
discovered-in: main session — boxholder idea alongside the /admin chat landmark
area: callback-box
priority: backlog
---

In the `/admin` chat (the admin landmark — see
[admin-landmark-maintenance-owner](2026-07-15-admin-landmark-maintenance-owner.md)),
the model should be able to **request a secret** — an API token, connector
credential, webhook secret — by rendering *"here's a field; what you type goes into
X"*, so the boxholder can hand over a token that flows **straight into the secret
store and never enters the chat transcript or the model's context**. The model
declares *what* it needs and *where* it goes; it gets back only a success/failure
confirmation, never the value.

This is the natural complement to the admin landmark: agents frequently need the
boxholder to supply a credential (set up a connector, rotate a key), and today the
only path is the boxholder pasting it into chat — which puts the raw secret in the
session transcript, the `.jsonl`, and every subsequent model context (and, on other
backends, the model provider). This feature closes that hole.

### What already exists to build on

- **Interactive chat tags/widgets** — the model already emits `<ack>`, `<callout>`,
  `<capture>`, `<schedule>` pseudo-XML that renders as inline UI in the chat stream
  (`src/core/chat/session/prompts.ts`); `<schedule>` even performs a side effect (arms
  a timer). A `<secret-request …>` widget is a new member of this family — a
  **synchronous, inline input field** the model renders and the boxholder fills in the
  moment, with the value routed straight to the store.
  - **Explicitly NOT the questions subsystem.** Questions (`docs/questions.md`) are an
    async, queue-based, *precedent-learning* process (a question card, a declared
    learning destination, an answer that becomes a rule). This is a different sort of
    process: a real-time widget that captures one value and produces no card, no
    learning destination, and no transcript entry.
- **A secret store already exists** — connectors read `config/connectors/<name>.secret.json`
  (legacy) and `CB_GOOGLE_TOKENS_FILE` (Google), gitignored
  (`src/connectors/requirements.ts`). "X" is this store; the request names a target
  within it.
- **Admin surface** — `AdminPage.tsx` + the admin tRPC router already own
  credential-adjacent config (Telegram, Google, allowed-emails). The write endpoint
  and gating live here; this is admin-privileged.

### The security contract (the whole point)

- The secret value goes **frontend field → backend write-endpoint → secret store**,
  bypassing the chat message pipeline entirely. It is **never** placed in a chat
  message, the session transcript, the `.jsonl`, or any model turn.
- The model's context receives only a **confirmation** ("secret `telegram-bot-token`
  saved") — a boolean/redacted result, not the value.
- The model can request **overwrite/rotate** but can never **read** the current
  value.

### Design questions

- **The declaration.** A `<secret-request name=… label=… target=… description=…>`
  tag: `name` (identifier the model refers to), `label` (what to show the boxholder),
  `target` (which store slot), `description` (why/where the boxholder gets the token).
  What's the target grammar, and how is it **restricted** so the model can't write an
  arbitrary path — an allowlist of connector/secret slots, not a free filesystem
  target.
- **Widget lifecycle.** It's a new inline chat widget (in the `<schedule>`/`<capture>`
  family), resolved synchronously in the stream — not a queued card. Define its states
  (pending → filled / expired / cancelled) and how the resolution is signaled into the
  model's next turn (the redacted confirmation), including when the boxholder ignores it.
- **Rendering + submit.** A masked input widget in the chat stream; on submit, a
  direct tRPC/route call `{ sessionId, requestId, target, value }` → writes to the
  store → returns success. The value never round-trips through the model.
- **Post-save verification.** Optionally test the credential (e.g. the token
  authenticates) and report *works/doesn't* to the model — without revealing it.
  Turns "did you paste it right?" into a checkable result the agent can act on.
- **Scope + gating.** Admin-privileged — only in the `/admin` landmark chat, not
  general chat (writing credentials is not a general-chat power). Tie to the admin
  landmark's context.
- **Audit.** Log that a secret was set (name, target, timestamp, actor) with the
  value redacted, so there's a trail without a leak.
- **Failure/expiry.** What if the boxholder doesn't fill it, navigates away, or the
  session ends — the request should expire cleanly and the model be told it's
  unfulfilled (again, no value).

Relatedly, this is the honest answer to a recurring need the connectors already
have (Telegram bot token, webhook secret, per-connector `*.secret.json`) — a
chat-native, transcript-safe way to populate `config/connectors/*.secret.json`
instead of hand-editing files or pasting into chat.
