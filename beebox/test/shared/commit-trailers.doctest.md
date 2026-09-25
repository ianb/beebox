# Commit triggers — one axis over every trigger trailer

A commit says what caused it through one of several trailers, written by
different subsystems: `Triggered-By:` (wakeups, ticks, doc generation),
`Procedure:`/`Step:` (a procedure run), `Run-By: trick/<name>` (a trick), and
the retired `Workflow:` that procedures wrote before the rename. The History UI
reads them as a single "triggered by" axis, so a procedure or trick commit is
distinguishable from a hand edit.

```ts setup
import {
  buildTriggerGrep,
  commitStep,
  commitTriggers,
  parseTriggerId,
  parseTrailersMulti,
  stripTrailers,
  triggerFromTrailer,
  triggerLabel,
} from "../../src/shared/commit-trailers.js";
```

## Each writer's trailer becomes a kind-prefixed trigger id

The id is what a filter persists; the name is what a boxholder reads. `trick/`
is already the shape the trick runner writes, so its name is the bare trick.

```ts
["Triggered-By", "Procedure", "Run-By"]
  .map((key) => triggerFromTrailer(key, key === "Run-By" ? "trick/tidy-inbox" : "bbx wakeup"))
  .map((t) => `${t?.kind} ${t?.id}`)
  .join(" | ")
=> command command/bbx wakeup | procedure procedure/bbx wakeup | trick trick/tidy-inbox
```

A key that names something other than a trigger — a connector, a phase — is
not one, so the axis stays about what ran rather than what it touched.

```ts
JSON.stringify([
  triggerFromTrailer("Pulled-By", "gmail-connector"),
  triggerFromTrailer("Phase", "brief"),
  triggerFromTrailer("Triggered-By", "   "),
])
=> [null,null,null]
```

## Pre-rename `Workflow:` history answers the procedure filter

`Workflow:` has no writer left, but a box's existing commits have it. It reads
as the same procedure id, so selecting a run finds both its pre- and
post-rename commits instead of silently dropping the older half.

```ts
const old = triggerFromTrailer("Workflow", "process-news");
const now = triggerFromTrailer("Procedure", "process-news");
`${old?.id} === ${now?.id}: ${old?.id === now?.id}`
=> procedure/process-news === procedure/process-news: true
```

## A commit's triggers, ordered by kind, with its step

Procedure commits carry no `Triggered-By` at all — reading only that key is
what made them look like hand edits.

```ts
const trailers = parseTrailersMulti("Procedure: refresh-maps\nStep: triage\nSession: abc12345");
commitTriggers(trailers).map(triggerLabel).join(" | ") + ` @ ${commitStep(trailers)}`
=> procedure refresh-maps @ triage
```

A hand edit names nothing, which is the distinction the timeline draws.

```ts
JSON.stringify([commitTriggers(parseTrailersMulti("")), commitStep(undefined)])
=> [[],null]
```

Two conventions on one commit both show, procedures before commands.

```ts
commitTriggers(parseTrailersMulti("Triggered-By: bbx tick\nProcedure: nightly"))
  .map((t) => t.id)
  .join(" | ")
=> procedure/nightly | command/bbx tick
```

## Trailers the UI renders are stripped from the body it shows

```ts
stripTrailers([
  "Refreshed the map index.",
  "",
  "Procedure: refresh-maps",
  "Step: refresh",
  "Run-By: trick/tidy",
  "Workflow: old-name",
  "Session: abc12345",
].join("\n"))
=> Refreshed the map index.
```

## One `--grep` pattern per selection, ANDed by git against other axes

Each kind maps back to the key its writer used, and the procedure kind matches
the retired spelling too.

```ts
buildTriggerGrep(["procedure/refresh-maps", "trick/tidy", "command/bbx wakeup"])
=> ^((Procedure|Workflow): refresh-maps|Run-By: trick/tidy|Triggered-By: bbx wakeup)$
```

Regex metacharacters in a run name are escaped, not interpreted.

```ts
buildTriggerGrep(["command/bbx tick (retry)"])
=> ^(Triggered-By: bbx tick \(retry\))$
```

An id that names no kind is refused rather than dropped: a silently omitted
axis would widen the result to every commit.

```ts
JSON.stringify([parseTriggerId("process-news"), parseTriggerId("nope/x"), parseTriggerId("procedure/")])
=> [null,null,null]

buildTriggerGrep(["process-news"])
=> throws InvariantError: not a trigger id: "process-news"
```
