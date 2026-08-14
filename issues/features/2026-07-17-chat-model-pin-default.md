---
title: "Pin a model as the box default in the chat selector; chats can follow the default"
workstream: unknown
needs: [design]
filed-by: agent
discovered-in: main session — boxholder idea while thinking about the chat model selector
area: callback-box
next-action: duplicate
---

Add a **pin** affordance next to each model in the chat model selector. Two
distinct actions per row:

- **Select** — set *this chat's* model (as today, roughly).
- **Pin** — make that model the **box default**: the model any chat that hasn't
  specified one uses.

Chats then carry a **"default" setting** — a chat left on default follows the box
default, and its effective model changes when the default changes. Semantics for
live sessions: **changing the default does not restart active sessions**; a session
keeps its current model until it next cold-starts, and picks up the new default on
warm-up.

### Why this needs design — the current model is box-global, not per-chat

Today there isn't really a per-chat model *and* a separate default; there's **one
box-wide pointer**:

- `saveCurrentModel`/`loadPersistedChatModel` read+write a single box file,
  `.callback-box/chat-model.json` (`src/core/chat/session/state.ts:95-145`).
- Every `ChatSession` defaults `modelFile` to that same box path
  (`src/core/chat/session/index.ts:106`), and holds an in-memory
  `currentModel: string | null` (`index.ts:86`) where **null means the SDK
  default**, not "follow the box default."
- The selector calls tRPC `setModel({ session, model })`
  (`src/webapp/trpc/routers/chat-control-procedures.ts:51`), which sets the
  session's model **and can restart it** (returns `restarted`).

So selecting a model is effectively box-global and restart-y — which is the
*opposite* of the proposed "pin the default without restarting live chats." The
idea needs a genuine two-level split:

- **Box default** = the pinned model (reuse `chat-model.json` as the pin target).
- **Per-chat model** = an explicit model **or** the sentinel "default" (follow the
  box default). This is a new persisted per-chat concept — today the per-chat model
  is in-memory only and defaults to the shared box file.

### Design questions to settle

- **Three-state per-chat model.** Reconcile the proposed states — `explicit(modelId)`
  | `default` (follow box) — with today's `currentModel: string | null` where
  `null` = SDK default. Almost certainly: unset/"default" should mean *follow box
  default*, and the raw SDK-default case folds into "the box default is unset." Define
  the migration of `null`'s meaning.
- **Per-chat persistence.** For a chat to remember "explicit X" vs "default" across
  warm-ups, that must persist per session (not the shared box file, and not just
  in-memory `currentModel`). Where — the session state file, a sidecar? This is the
  core new storage.
- **Pin path ≠ select path.** Pinning writes the box default and must **not** restart
  active sessions (unlike today's `setModel` restart). Decide whether *selecting* for
  the current chat still restarts to apply immediately, or also defers to warm-up.
- **Warm-up resolution.** A default-following session resolves its effective model
  from the box default at cold-start/warm-up (around the constructor/start,
  `index.ts:100+`), read lazily so a live warm session keeps its resolved model until
  it restarts. Confirm nothing swaps a warm session's model mid-flight.
- **Selector UX.** Each row gets a pin icon (set box default) beside select (set this
  chat). Show which model is the pinned default, and mark a chat that's *on default*
  so it reads as inheriting — a default chat should display the currently-resolved
  model with a "default" indicator, distinct from an explicit same-model pick, so when
  the default changes the inheriting chats visibly follow.
- **Scope of "any chat that isn't specified."** New chats presumably start on
  "default." Existing chats: do they retroactively become "default," or keep whatever
  they last resolved to? (Given today's box-global behavior, most are implicitly on
  the default already.)

Surfaces: `src/frontend/src/components/chat/InteractiveChat*.tsx` (selector UI),
`src/webapp/trpc/routers/chat-control-procedures.ts` (setModel + a new set-default),
`src/core/chat/session/{state,index,options}.ts` (box pointer, per-session model,
modelFile). Same selector touched by the recent Sonnet-5 label/id fix.
