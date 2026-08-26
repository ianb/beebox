# Which model a box thinks with

A box has one **model policy** and any number of chats that may disagree with
it. This describes where each lives, who reads it, and when a change takes
effect.

## Two levels

**The box default** is `agentModel` in `config/box.json`, beside `agentEngine`.
It holds a concrete model id (`claude-sonnet-5`, `gpt-5.6-terra`, …). Missing
means *no policy*: every run takes its harness's own default. It is owner-only
to change, and the change is committed to the box's git history like any other
config edit.

**A chat's own model** is `.callback-box/chat-models/<sessionId>.json`, written
only when that chat picks one. **Absence is a state, not a gap**: a chat with no
file *follows* the box default, and keeps following it — so pinning a new
default changes what every unopinionated chat starts on.

## What reads the policy

| Reader | When it resolves |
|---|---|
| A chat | When its subprocess starts (cold start or restart). |
| The reactor | Once per run, before its agents are created. |

Everything else is unchanged: a caller that names a model still gets that model.
Procedure steps with a `model:` tier, the retro observer, and the chat reviewer
all name theirs, and a procedure step that omits `model:` still means "the
harness default" — the policy is read at the two call sites above, not inside
`createAgent`. (Why: `docs/plans/model-engine-policy.md`.)

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

## Where the controls are

- **Chat** — the session chip's Model panel. A row selects for this chat; the
  pin beside it (owner only) sets the box default. The first row shows what
  following the default currently gets you. The chip itself marks a chat running
  above or below the default, by tier.
- **Settings** — "Agent engine and model" sets the engine and the default
  together.

## History

`.callback-box/chat-model.json` was the box-wide pointer a chat inherited when
it had no id yet — which every chat on a Codex box did, since coined ids are
Claude-only. The `chat-model-to-box-config` migration folds it into `agentModel`
and removes it.
