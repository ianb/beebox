# Gallery

The agent-exercise corpus: real tasks given to real agent runs against
canvas-loop, kept with enough metadata to understand how the library performs
across time, tasks, and models. This is not a demo folder — it's the evidence
base the [`LIBRARY-PLAN.md`](../LIBRARY-PLAN.md) and
[the design issue](../../issues/exploration/2026-07-13-canvas-tight-loop-agent-programming.md)
draw on.

## Schema

```
gallery/
  README.md
  <slug>/
    task.md        the prompt the agent received (verbatim where recorded;
                    otherwise a best-effort reconstruction — see `reconstructed`
                    in meta.yaml)
    sketch.ts       the sketch AS DELIVERED (post-audit), mutable tier — OR
    sketch-tea.ts   … TEA tier (the tea/* lint discipline keys off this exact
                    filename, same convention as examples/)
    events.json     the scripted events file the sketch was run with
    meta.yaml       see fields below
    runs.jsonl      append-only re-exercise log (one JSON object per line)
```

Exactly one of `sketch.ts` / `sketch-tea.ts` exists per exercise — whichever
matches the tier the sketch was authored in (`meta.yaml`'s `tier` field says
which).

**No PNGs or transcripts are committed.** Output is fully determined by
`(sketch, events, seed, harness-commit)`; committing source + metadata keeps
the corpus reviewable and light. Reproducing an *old* run's exact pixels means
checking out that `harness-commit` and re-running — `runs.jsonl` records what
was actually observed at the time, so that trade-off doesn't lose information.

### `meta.yaml` fields

| Field | Meaning |
| --- | --- |
| `slug` | matches the directory name |
| `title` | short human title |
| `created` | date the exercise was authored (`YYYY-MM-DD`) |
| `model` | the agent model that wrote the sketch (e.g. `sonnet-5`, `opus-4.8`) |
| `driver` | who orchestrated the exercise (e.g. `fable-5`) |
| `cycles` | write→run→read-transcript iterations to the delivered result |
| `tier` | `mutable` or `tea` |
| `harness-commit` | the canvas-loop commit the sketch was authored against |
| `frames`, `seed`, `fps`, `every` | the CLI run parameters `gallery check` uses to render it (`seed`/`fps`/`every` default to the CLI's own defaults — 42/60/30 — if omitted) |
| `reconstructed` | `true` if `task.md` is a reconstruction rather than the verbatim prompt |
| `audit` | verdict + notable gaps from independent review (frame inspection, stranger test, lint/determinism audit — whatever was actually done) |
| `self-report-summary` | 2–3 sentences of the agent's own account of the exercise |
| `features-exercised` | list of library features the sketch exercises (params types, pointer/keyboard handling, trails, gradients, etc.) |

### `runs.jsonl`

One JSON object per line, append-only, oldest first. Each entry:

```json
{"date": "2026-07-14", "commit": "1b8285e9", "model": "sonnet-5", "action": "authored", "cycles": 3, "outcome": "pass", "notes": "…"}
```

`action` is `authored` (the original exercise), `rerun` (same sketch/events
re-rendered against a later harness commit — a regression/compatibility
check), or `ported` (rewritten for a new tier or API shape). `model` is
omitted for a mechanical `rerun` that involves no agent.

## Adding an exercise

1. Give an agent a visual/interactive task using canvas-loop (mutable or TEA
   tier); let it run the normal write→run→Read-transcript loop.
2. Once the result is good, create `gallery/<slug>/`: copy in the final
   `sketch.ts`/`sketch-tea.ts` and `events.json`, write `task.md` (the actual
   prompt given, or a clearly-marked reconstruction), and `meta.yaml`.
3. Add one `runs.jsonl` line with `"action": "authored"`.
4. Run `pnpm --dir canvas-loop run gallery:check` — it must pass (determinism
   + lint) before the exercise is committed.

## Re-exercising

To check an existing exercise still holds against a later harness commit,
re-run it unchanged (`pnpm --dir canvas-loop run cli run gallery/<slug>/sketch*.ts --events gallery/<slug>/events.json`),
compare by eye against the last recorded audit, and append a `rerun` line to
its `runs.jsonl`. Re-exercise cadence is manual, by design (see
`LIBRARY-PLAN.md`'s open questions) — there is no scheduled job.

## `gallery check`

```sh
pnpm --dir canvas-loop run gallery:check
```

Renders every exercise **twice** into a scratch temp directory (never into
`gallery/`), asserts the two runs are byte-identical (determinism), and lints
the sketch file. Read-only and side-effect-free on the repo; suitable as a
package test-suite step.
