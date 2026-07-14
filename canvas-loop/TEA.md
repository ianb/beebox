# TEA sketches (The Elm Architecture)

A second sketch tier for canvas-loop. Where the [mutable tier](./README.md)
gives you p5-style `setup`/`draw` with free-floating state, a **TEA sketch** is a
pure fold: `model = msgs.reduce(update, init())`, then `draw` renders it. State
changes only by `update` returning a new `Model`. This is a Redux reducer — the
most training-saturated shape there is — with Elm's guarantees enforced by types,
a runtime deep-freeze, a double-run byte-diff, and lint.

Same CLI, same transcript. The runtime picks the tier by detecting an `update`
export:

```sh
pnpm --dir sandbox/canvas-loop run cli run examples/orbit-tea.ts \
  --events examples/orbit-tea-events.json --out out
```

Name TEA sketches `*-tea.ts` — the TEA lint discipline is scoped to that suffix
so the two tiers can share `examples/`.

## Contract

A TEA sketch imports **only** `../src/tea.js` (types only) and exports:

```ts
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "../src/tea.js";

export const params = { /* … */ } as const satisfies ParamsDecl;   // optional
export const canvas = { width: 500, height: 400 };                 // optional (default 400×300)

export type Model = { /* your state */ };                          // sketch-defined

export function init(u: Util<typeof params>): Model;
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model;
export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void;
```

- **`init`** runs once, before frame 0, returning the initial `Model`.
- **`update`** folds one `Msg` into a new `Model`. Pure: same inputs → same
  output. Return a *new* value — never mutate `model` (it is deep-frozen; a
  mutation throws).
- **`draw`** paints the `Model`. View-only: no randomness, no state store beyond
  the `p` argument. It cannot change the world.

Capabilities are injected, not ambient — `update` gets `Util` (randomness,
params, log) and no drawing; `draw` gets `View` (drawing, log, snapshot, `ctx`)
and no randomness. That withholding *is* the enforcement.

`View` carries the same drawing surface as the mutable `Sketch` (see the
[README API table](./README.md#the-sketch-api)), including the organic-shape
primitives — `polygon`, `path` (data-encoded commands), `arc`, `clip`, and
`linearGradient`/`radialGradient` handles that `fill`/`stroke`/`background`
accept as a `Paint`. `v.ctx` remains the escape hatch, but these should now
cover curves/gradients/clipping so a `draw` stays serializable-in-principle.
[`examples/fjord-tea.ts`](./examples/fjord-tea.ts) is a worked port that draws a
full tidal-fjord scene through them with zero `ctx`.

The lint preset caps functions at 2 parameters; the `update`/`draw` contract
signatures are the one sanctioned exception. Put this exact comment on each
(and nowhere else):

```ts
// eslint-disable-next-line max-params -- TEA contract signature
```

## The `Msg` union

Time is a message; input, param edits, and triggers are the rest. Switch
exhaustively on `msg.type` (the type-aware lint enforces it):

```ts
type Msg =
  | { type: "tick"; frame: number }
  | { type: "mousedown"; x: number; y: number }
  | { type: "mouseup"; x: number; y: number }
  | { type: "mousemove"; x: number; y: number }
  | { type: "keydown"; key: string }
  | { type: "keyup"; key: string }
  | { type: "param"; name: string; value: number | boolean | string }
  | { type: "trigger"; name: string };
```

## Frame-N guarantee

For each frame N, the runtime:

1. dispatches every scripted event for frame N, **in file order**, as msgs
   (a `param` event updates the runtime's param store *and* becomes a `param`
   msg; a `trigger` event becomes a `trigger` msg),
2. then dispatches `{ type: "tick", frame: N }`,
3. folding each through `update` in that order,
4. then calls `draw` **once** with the resulting model.

So the world an event sees is exactly the state after frame **N−1**'s draw, and
`draw` runs exactly once per frame. `init` runs once before frame 0.

## Params reference

`params` is a record of declarations. Four types:

| Type | Declaration | `p` value |
| --- | --- | --- |
| number | `{ type: "number", min, max, default, step? }` | `number` |
| boolean | `{ type: "boolean", default }` | `boolean` |
| select | `{ type: "select", options: [...] as const, default }` | union of `options` |
| trigger | `{ type: "trigger" }` | — (arrives only as a `trigger` msg) |

Declare with `as const satisfies ParamsDecl` so selects narrow to their option
union. Read values via `u.params.name` (in `update`) and the `p` argument (in
`draw`). Triggers carry no value — handle the `{ type: "trigger", name }` msg.

## Events file

The same JSON array as the mutable tier, plus two TEA-only entry types. Each is
validated against `params` — an unknown name or wrong value type is a clear
error before frame 0:

```json
[
  { "frame": 30, "type": "mousedown", "x": 297, "y": 288 },
  { "frame": 40, "type": "keydown", "key": "ArrowUp" },
  { "frame": 55, "type": "param", "name": "focus", "value": "Earth" },
  { "frame": 70, "type": "param", "name": "speed-scale", "value": 2.5 },
  { "frame": 85, "type": "param", "name": "show-orbits", "value": false },
  { "frame": 110, "type": "trigger", "name": "reset" }
]
```

Input types (`mousedown`/`mouseup`/`mousemove`/`keydown`/`keyup`) match the
mutable tier. A `param` change adds an automatic transcript line:
`**[frame 70]** param: speed-scale → 2.5`.

## The discipline (one list)

- **All state in `Model`.** No module-level `let`/`var`; `const` for fixed
  data/functions only.
- **State changes only by `update` returning a new `Model`.** Never mutate
  `model` (assignment, `delete`, `push`/`splice`/`sort`/…).
- **Modes as a discriminated-union field** on the model
  (`mode: { type: "idle" } | { type: "dragging"; index: number }`) + exhaustive
  switch — a statechart's modal part, zero machinery.
- **No async.** No `async`/`await`/`.then`/`new Promise`; runs are synchronous.
- **Exhaustive switch on `msg.type`.** List every case; no `default`.
- **Import only `../src/tea.js`**, types only.

Lint enforces all of it on `*-tea.ts` (`tea/no-module-state`,
`tea/no-model-mutation`, `tea/no-async-sketch`, `tea/no-classes`,
`no-restricted-imports`, and type-aware `switch-exhaustiveness-check`).

## Worked example

[`examples/orbit-tea.ts`](./examples/orbit-tea.ts) +
[`examples/orbit-tea-events.json`](./examples/orbit-tea-events.json) — a sun with
three orbiting planets. It exercises every param type (`speed-scale` number,
`show-orbits` boolean, `focus` select, `reset` trigger), a mode union
(`{ type: "idle" } | { type: "selected"; index }`), and direct pointer
manipulation (click a *moving* planet to select it; ArrowUp/Down nudge its
speed). Because position is a pure function of `frame`, hit-testing a moving
target is a calculation, not trial-and-error:

```ts
function planetPos(a: { planet: Planet; frame: number; scale: number }) {
  const angle = a.planet.angle0 + a.planet.speed * a.scale * a.frame;
  return { x: CENTER_X + a.planet.orbitRadius * Math.cos(angle), /* … */ };
}
```

`update` returns new models — nudging a planet's speed rebuilds the array
immutably, selection swaps the `mode` field:

```ts
case "keydown":
  return nudgeSelected({ model, key: msg.key, u });   // → { ...model, planets: planets.map(…) }
case "trigger":
  return msg.name === "reset" ? init() : model;
```

Note the boundary: `reset` restores the *model* (planets, selection) but leaves
the *params* (`speed-scale`, `show-orbits`) at their current values — params are
the runtime's store, model is the sketch's.
