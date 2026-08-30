# Which model a box thinks with

A box has one **model policy** and any number of chats that may disagree with
it. This describes where each lives, who reads it, and when a change takes
effect.

## Three settings, one file

`config/box.json` holds all of it, beside `agentEngine`:

| Field | What it decides |
|---|---|
| `agentModel` | The box default model — what chat and the reactor use when nothing more specific applies. |
| `smallModel` | The model for the cheap structured passes (chat review, retro observation, triage). Missing means the `efficient` tier for whichever engine runs the pass. |
| `engines` | Which harnesses a new chat may be started on. Missing means only `agentEngine`; the default engine can never be disabled. |

## Two levels

**The box default** is `agentModel` in `config/box.json`, beside `agentEngine`.
It holds a concrete model id (`claude-sonnet-5`, `gpt-5.6-terra`, …). Missing
means *no policy*: every run takes its harness's own default. It is owner-only
to change, and the change is committed to the box's git history like any other
config edit.

**A chat's own model** is `.beebox/chat-models/<sessionId>.json`, written
only when that chat picks one. **Absence is a state, not a gap**: a chat with no
file *follows* the box default, and keeps following it — so pinning a new
default changes what every unopinionated chat starts on.

## What reads the policy

| Reader | Which setting | When it resolves |
|---|---|---|
| A chat | `agentModel` | When its subprocess starts (cold start or restart). |
| The reactor | `agentModel` | Once per run, before its agents are created. |
| Chat review, retro observation, triage | `smallModel` | Per run. |

Everything else is unchanged: a caller that names a model still gets that model,
and a procedure step that omits `model:` still means "the harness default" — the
policy is read at the call sites above, not inside `createAgent`. (Why:
`docs/implemented-plans/model-engine-policy.md`.)

The small passes used to name `"haiku"`, a Claude nickname the Codex harness
forwarded to the Codex SDK verbatim. Nothing names a model as a bare string any
more: every value passes through the resolver, which cannot produce a name the
running engine does not know.

## Resolution

`src/core/model-policy.ts` is the only ladder. In order:

1. The chat's own model, if it has one this engine can run.
2. The box default — exactly, if this engine offers it; otherwise the model at
   the same tier (`efficient`/`balanced`/`strong`/`strongest`, from
   `src/shared/agent-models.ts`), so a box that switches harness keeps a policy
   rather than silently losing one.
3. Nothing — the harness's own default.

Retired model ids are carried forward (`normalizeModelId`) before any of this,
and a value no engine offers is rejected at `loadBoxModel` with one warning per
config load.

## Changing it does not interrupt anything

Pinning a default restarts no session. A chat that is already running keeps the
model its subprocess started with and picks the new default up the next time it
starts cold; `chat.status` reports the model actually in force plus a
`pendingModel` naming what a restart would change it to.

Choosing a model *for one chat* is the other case and does restart it — an
explicit choice is an instruction to that conversation, deferred past a turn in
flight so no response is lost.

## A chat's engine is fixed at birth

A chat's model can change whenever. Its **engine** cannot: transcripts live in
different stores per engine (a Codex chat's history is Codex's own thread; a
Claude chat's is husk JSONL on disk) and models are engine-scoped, so switching
mid-chat would silently change two things at once and strand the transcript.

So the engine is chosen **before the first message**, in the same picker as the
model: each enabled engine gets a section, and picking a model under one is how
you choose it. `resolveStartEngine` enforces the rule where it is read — a
recorded engine always wins over a requested one.

Two carriers, because only Claude accepts an id the browser chose:

- **Claude** — the chat coins its own id, and the choice rides the reservation.
- **Anything else** — no id to reserve, so the choice rides the `"new"` send.

Switching engines therefore restarts a chat that has not spoken yet: the coined
id is abandoned (its reservation expires on its own) and the chat comes back
through `?session=new` carrying the choice. Nothing is lost, because this is
only reachable before the first message.

## How much context a run gets

The same question — what does *this* invocation get — covers context, and it has
one lever: `loadBoxContext`. The SDK loads the box's `CLAUDE.md`, generated agent
guide and `.claude/rules/` by default, which is right for the reactor, procedure
runs and chat. The four small structured passes set it false: measured on the
test box that context is ~9,700 words on every invocation, and a pass emitting a
title or a verdict cannot use it. It is an opt-out, never a default, and it is
Claude-only — the Codex harness has no equivalent.

## Where the controls are

- **Chat** — the session chip's Model panel. Each enabled engine has a section
  using its own model names, the chat's engine first and the box's default
  marked. A row selects for this chat; a row under another engine's heading
  starts the chat there (before its first message only, after which that heading
  says so). The pin beside a row (owner only, and only in the box's default
  engine's section) sets the box default. The first row shows what following the
  default currently gets you. The chip marks a chat running above or below the
  default, by tier.
- **Settings** — "Agent engine and model" sets the default engine, which engines
  are available at all, and the default model.

## History

`.beebox/chat-model.json` was the box-wide pointer a chat inherited when
it had no id yet — which every chat on a Codex box did, since coined ids are
Claude-only. The `chat-model-to-box-config` migration folds it into `agentModel`
and removes it.
