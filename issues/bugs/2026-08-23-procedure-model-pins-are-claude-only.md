---
title: "A procedure's `model:` pin is a Claude name, so every pinned procedure fails silently on a codex box"
workstream: unattached
area: callback-box
priority: important
labels: [codex, procedures, scheduler]
filed-by: agent
discovered-by: Ian
discovered-in: main session — refresh-maps still failing after the AGENTS.md fix landed
---

A procedure step can pin a model:

```yaml
model: haiku
max-turns: 40
```

`core/procedure/engine-types.ts:79` and `engine-validate-model.ts` map those
friendly names (`haiku` / `sonnet` / `opus`) to **Claude** model ids, and
`core/agent/codex-run.ts:73` passes `options.model` straight into the Codex SDK
session. Nothing translates it, and nothing validates it.

So on a box with `agentEngine: codex`, a pinned procedure asks Codex for a
Claude model. Codex fails immediately: **the run produces no assistant turn at
all** and the step exits 1.

## It ships broken

The stock templates pin Claude names:

```
templates/procedures/refresh-maps.procedure.card    model: haiku
templates/procedures/process-pages.procedure.card   model: sonnet
```

So `refresh-maps` — a default-enabled schedule on a fresh box — fails every day
on any codex box, from installation, with no action by the user.

## Evidence

On an affected box, every agent-backed procedure that **works** has no model
pin; the one that **fails** pins one:

| procedure | model pin | state |
|---|---|---|
| `demo-daily-rumination` | none | succeeds |
| `demo-weekly-research` | none | succeeds |
| `refresh-maps` | `haiku` | fails daily |

Reading the Codex threads confirms the mechanism rather than inferring it. A
successful run's thread holds 8 entries — assistant messages and tool calls. The
failing run's thread holds **2 entries, both `user`**: the step prompt, then the
validation-failure retry. No assistant turn was ever produced, twice.

## The silence is its own defect

Nothing anywhere says why. The run card records `validate: fail` (the
downstream symptom), the scheduler's log has no entry, the box log has none, and
`cb health` reports only `Command failed with exit code 1`. The single piece of
evidence that identifies the cause is an empty agent thread, reachable only by
reading Codex's thread store directly.

An engine rejecting a model is a precise, knowable error. It should be reported
as one — this cost an evening of diagnosis that a single log line would have
ended.

## Fix directions

Worth deciding rather than assuming:

- **Translate per engine.** `haiku`/`sonnet`/`opus` are intent ("cheap", "mid",
  "strong"), not identity. A codex box could map them onto its own tiers. This
  keeps one template working on both engines, which is the property the stock
  cards need.
- **Validate and fail loudly.** Chat already has `isChatModelAllowed(engine,
  model)`; procedures have no equivalent. At minimum a pin that the engine
  cannot honor should be a clear error at step start, not an empty thread.
- **Ignore a foreign pin and warn.** Falling back to the engine default keeps
  the box working; the risk is a step silently running on a much more expensive
  model than the author intended, so it must be visible.

Whichever is chosen, the stock templates should not ship a pin that only one
engine can honor.

## Same disease as the AGENTS.md bug

This is the second instance in two days of a Claude-shaped assumption in code
that never learned about codex — see
[AGENTS.md missing from the CLAUDE.md special-cases](../closed/bugs/2026-08-22-agents-md-missing-from-claude-md-special-cases.md),
whose fix landed on 2026-08-22 and demonstrably works (the AGENTS.md entries are
gone from the precheck's task list). That issue argued for a structural guard so
the pairing cannot drift again. This one suggests the guard needs to cover more
than filenames: **anywhere the code names a Claude-specific thing, a codex box
is a live case that nothing currently tests.**

A codex box running the stock schedule set would be the honest end-to-end test,
and nothing like it exists today.
