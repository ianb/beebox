---
title: "No way to pick a chat's engine — models are switchable per chat, engines are box-wide"
workstream: model-engine-policy
area: callback-box
needs: [design]
labels: [chat, codex, engines]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder wanting a codex chat on a claude box, or the reverse
---

> There's no way to convert a chat between engines. Old chats still use the old
> engine, but new chats can't change in the way models can change. It would
> still only support it on new chats.

A chat's **model** is a per-chat choice that can change mid-conversation. Its
**engine** is whatever the box was set to when the chat started, and nothing
offers a choice.

> **Considered and deferred 2026-08-25** by the model/engine policy work
> (`callback-box/docs/implemented-plans/model-engine-policy.md`), which shipped the
> *model* half — a box default model that chat and the reactor both read, with a
> per-chat override. This issue was carried as a fifth track and cut, because it
> is a bigger mechanism than the "thread one existing parameter" the note below
> suggests: `reserveSession` takes no engine
> (`webapp/trpc/routers/chat-control-procedures.ts`), `registry.reserve` takes
> none (`core/chat/session/registry.ts`), and coined ids are Claude-only by
> contract (`core/chat/session/reserve.ts` returns `unsupported` for a codex
> box). So offering the choice on a Codex box means changing how a chat is
> *named*, not adding a menu. It wants its own plan.

## Where it stands today

`core/chat/session/engine.ts:6-13` is the whole rule:

```ts
if (sessionId === null) return loadAgentEngine(boxRoot);
const entry = (await loadHistoryEntries(boxRoot)).find((c) => c.id === sessionId);
return entry?.engine ?? "claude";
```

So a **new** chat silently takes the box-wide default, and an **existing** chat
keeps the engine recorded against it. The second half already works — per-chat
engine is recorded (`chat-session-history` v3 added `engine`; a missing value
decodes as `claude`), which is why old chats correctly stay where they were.
The gap is only that nothing lets you choose for a new one.

Compare `setModel` (`webapp/trpc/routers/chat-control-procedures.ts:154-165`),
which takes a session, validates with `isChatModelAllowed(engine, model)`, and
restarts the subprocess so the next turn picks it up — deferring the restart
past a busy turn rather than losing the response.

**The plumbing is already half there.** `history.ts:235` records
`opts.engine ?? await loadAgentEngine(boxRoot)` — an explicit engine is
accepted at session-record time and simply never supplied by a caller. So this
is likely a matter of offering the choice and threading it, not of building
per-chat engine support.

## New chats only, and the reason is real

The boxholder scoped this to new chats. That is not a simplification to revisit
later — mid-chat conversion is closer to impossible than to hard:

- **Transcripts live in different stores.** A Codex chat's history is Codex's
  own thread, read over the app-server RPC (`chat/session/codex-transcript.ts`);
  a Claude chat's is husk JSONL on disk. There is no shared representation to
  hand across, and a conversion would have to reconstruct one side's turn
  history in the other's format, including tool calls.
- **Models are engine-scoped.** `isChatModelAllowed(engine, model)` already
  gates this, so switching engine mid-chat would invalidate the chat's model
  too, silently changing two things at once.

Worth saying in whatever ships: a chat's engine is fixed at birth, deliberately.

## What to decide

- **Where the choice lives.** The model picker is a running-chat control; engine
  is a creation-time one. Same menu with the control disabled after the first
  message, or something attached to starting a chat? They are different
  affordances and putting engine in the model menu may imply it can change.
- **What the box default then means.** Presumably it stays as the default for a
  new chat, with the per-chat pick overriding it — but say so, since
  `loadAgentEngine` is currently the only answer and some code may treat it as
  the box's engine rather than a default.
- **Whether an unset choice should be visible.** A chat that took the default is
  indistinguishable from one that chose; the recorded value looks the same
  either way.

## One thing checked and ruled out

A per-chat engine on a box whose default is the other engine does **not** hit a
missing-context problem: `AGENTS.md` mirror generation
(`core/agent-context-mirrors.ts` via `docs-gen/claude-md.ts:16`
`ensureAgentContext`) is **not** gated on the box's engine — every box gets
mirrors when docs are generated. Note the mirrors may simply be absent on a box
that has not run doc generation since the feature landed (observed: a
claude-engine box with none on disk at all), so "not engine-gated" is not the
same as "always present". Whether a codex chat should ensure its mirrors before
its first turn is worth a moment's thought rather than an assumption.

Related: [AGENTS.md missing from the CLAUDE.md special-cases](../closed/bugs/2026-08-22-agents-md-missing-from-claude-md-special-cases.md)
— the mirrors' current sharp edge, and the reason to be careful about assuming
where they are.
