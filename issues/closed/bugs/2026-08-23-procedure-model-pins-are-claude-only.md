---
title: "A procedure's `model:` pin is a Claude name, so every pinned procedure fails silently on a codex box"
workstream: codex-model-pins
area: callback-box
priority: important
resolution: implemented
labels: [codex, procedures, scheduler]
filed-by: agent
discovered-by: Ian
discovered-in: main session — refresh-maps still failing after the AGENTS.md fix landed
---

**Closed — implemented.** Procedure cards now express portable intent with
`efficient`, `balanced`, `strong`, and `strongest`. The single engine-aware map
resolves those tiers as follows:

| tier | Claude | Codex |
| --- | --- | --- |
| `efficient` | Haiku | Luna |
| `balanced` | Sonnet | Terra |
| `strong` | Opus | Sol |
| `strongest` | Fable | Sol |

The old `haiku` / `sonnet` / `opus` / `fable` values remain compatibility
aliases for the same four rows, resolved through the current box engine. The
stock `refresh-maps` and `process-pages` cards now use portable tiers, and a
fresh-init regression test scans **every** stock procedure for provider-shaped
pins so a newly added template cannot repeat this silently.

**The silence is fixed at the native failure boundary, not only for this one
model.** A harness failure with no usable assistant activity (auth/model
rejection, startup/transport failure) is distinct from a started turn that made
partial progress. Declared run shells still execute because they may be
finalizers; the step then gates before validation. Run-agent failures land in
`run.error`; judge invocation failures land in `validate.error`; the exact cause
continues through the procedure CLI error, scheduler state, `cb health`, health
alerts, and the dashboard's collapsed schedule row. Procedure CLI errors are
flushed before exit. Timeouts retain their timeout headline when no more precise
child diagnostic exists.

**Coverage choice.** A full "run every stock schedule" integration test was not
added: the stock set deliberately depends on clocks and external connectors, so
such a test would mostly exercise unrelated fixtures. Instead coverage is split
at the stable seams: all installed templates are scanned, every tier and legacy
alias is mapped for both engines, a Codex-configured box runs through the real
procedure routing path, the default judge resolves to Terra, native
no-assistant failures and judge failures preserve their causes, and scheduler
surfaces select the actionable child error. A real `efficient` procedure was
also run successfully through Codex/Luna in the isolated `test1` clone, and its
thread contained a normal assistant response. The temporary fixture was
removed afterward.

No global model allowlist was added to generic `AgentInvokeOptions`: that seam
intentionally carries native model IDs for callers such as chat. Procedure
model policy is instead typed and centralized in the shared resolver, covering
initial agents, review retries, and instruction judges without making native
callers pretend their IDs are portable tiers.

Independent cross-model review found and drove fixes for the real Codex
`turn.failed` shape, Claude post-result/partial-work classification, judge-side
silence, truncated stderr selection, timeout preservation, and the dashboard
summary. Focused doctests, typecheck, lint, knowledge audit, browser checks, and
the complete callback-box and root suites are green.

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
