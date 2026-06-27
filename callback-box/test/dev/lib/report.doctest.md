# Knowledge-audit report — context baselines

The report opens with a context-baseline summary and annotates each audit's
baseline with its change since the prior run, so a trim shows up as a number
rather than a YAML diff you go find.

```ts setup
import { formatBaselineDelta, renderContextSummary } from "../../../src/dev/lib/report.js";

// Minimal duck-typed result — renderContextSummary reads only test.id and
// behavior.context. A null context means the audit measured no usage.
const res = (id, initialTokens) => ({
  test: { id },
  behavior: {
    context: initialTokens === null ? null : { initialTokens, peakTokens: initialTokens, addedTokens: 0, turnCount: 1 },
  },
});
const prior = (initial) => [{ date: "d", boxCommit: "b", repoCommit: "r", initial, peak: initial, added: 0, turns: 1 }];
```

## The delta clause compares a baseline to the prior run

```ts
JSON.stringify(formatBaselineDelta(38000, 41000))
=> "; -3k from last run"

JSON.stringify(formatBaselineDelta(41000, 38000))
=> "; +3k from last run"
```

Sub-1k drift is noise at the report's 1k resolution, and a first run has no
prior to compare against.

```ts continue
JSON.stringify(formatBaselineDelta(41200, 41000))
=> "; ~same as last run"

JSON.stringify(formatBaselineDelta(41000, undefined))
=> ""
```

## The summary table sorts baselines high→low with per-audit deltas

`alpha` shrank 3k since its last run; `beta` has no prior entry, so its delta is
blank. Rows are ordered by baseline, biggest first.

```ts
const out = renderContextSummary([res("beta", 38000), res("alpha", 41000)], { alpha: prior(44000) });
out.filter((l) => l.startsWith("|")).join("\n")
=> | Audit | Initial | Δ last run |
|---|--:|--:|
| alpha | 41k | -3k |
| beta | 38k | — |
```

The lowest baseline is called out as the cleanest estimate of the pure
always-on tier.

```ts continue
out[out.length - 2]
=> Lowest baseline ≈ pure always-on tier: 38k (`beta`).
```

## No measured context → no summary section

```ts
renderContextSummary([res("x", null)], {}).length
=> 0
```
