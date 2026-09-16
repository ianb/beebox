---
title: "Picking a model across engines is two-step: switching engine lands on its default model (Opus), and only then is Haiku reachable"
workstream: unattached
area: beebox
labels: [chat, ui]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — say switch to Haiku, it goes to Opus (default claude); only with Opus selected can I get to Haiku"
priority: normal
resolution: implemented
---

> **Fixed 2026-09-16.** The spanning model list this issue asked for was
> built — `SessionChip-model-panel.tsx` renders every engine's models and a
> cross-engine click calls `onChooseStart({ engine, model })`. The symptom
> survived anyway, reported again by the boxholder, because **two** places
> build a conversation start target and only one carried the model:
> `everywhere/resolve-conversation.ts` included it, while the fallback in
> `conversation/use-conversation-machine.ts` set `engine` and dropped `model`.
> That is precisely the reported behaviour — the engine switches, the model
> resets to that engine's default. The builder is now an exported pure
> function with its own regression test
> (`test/frontend/chat/conversation-start-target.doctest.md`); the two tested
> paths previously covered only the site that already worked.

In a new session's picker (SessionChip panels), engine and model are chosen
in separate steps that don't compose: asking for a specific model on the
non-current engine first commits the engine switch — which lands on that
engine's DEFAULT model (Opus for claude) — and only from there can the model
panel reach Haiku. The user's intent was one choice ("Haiku"); the UI made
it two, with a wrong intermediate state that starts the session on the wrong
model if they don't notice.

Direction: the choice is one gesture — the model list should span engines
(grouped by engine, default engine's group first, per the picker's existing
ordering rule), so "Haiku" is directly selectable and implies its engine.
`onChooseStart` already takes `{engine, model}` as one object, so the
plumbing supports it; the panels just don't offer it. If a spanning list is
too busy, the minimum fix is: engine switch does NOT commit until a model is
chosen (engine panel flows into that engine's model panel with nothing
started yet).

Watch the recorded-at-birth rule (`resolveStartEngine`: a chat's engine is
fixed once real) — the fix is purely pre-start picker flow; nothing about
switching a live chat.
