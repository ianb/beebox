# Stage 3 probe: scene cost

Part of `beebox/docs/plans/canvas-loop-scene.md`, Stage 3. Code (throwaway):
`scratch/stage3/scene-cost/`. Raw numbers: `node-results.json`,
`browser-results.json` in that folder.

## Question

What does draft 2.2 cost per frame, before any pixel is drawn? That means
recording every `v.*` call as a node (arguments captured by value), comparing
picture `deps` by value, hashing subtrees for cache reuse, diffing scenes, and
(in testing mode) re-recording every picture to audit stale `deps`.

## What was built

Two recorders behind one View-like class (`view-base.ts`).
- **A, object nodes** (`rec-a.ts`): one object per node, `cloneData` of every
  argument and style, hash computed afterwards by walking the tree.
- **B, typed arena** (`rec-b.ts`): nodes in typed arrays; arguments serialized
  by value into a reused Float64 arena; the hash is computed from the arena
  as each node closes. Almost no allocation per frame.
Pictures follow section 5: versions keyed by key, size and deep-equal `deps`
(deep equality also rejects functions); the audit re-records each picture each
frame and compares. `diff.ts` aligns siblings with prefix/suffix trimming plus
LCS on node data, and skips subtrees with equal hashes. A "reuse scan" walks
two scenes by position and counts unchanged subtrees.

The workloads call real code. The walker sheet and the Intra room (default
room, `intake`) run today's `draw` from `canvas-loop/src/gallery/` against the
recording view. Text measurement is a stub (`0.55 * size` per character), and
brushes are style data only, so no brush expansion is counted. A room's
`v.sprite`/`v.image` map to `picture`/`place` with empty `deps`. Particles:
5000 circles, each with its own radial gradient (also a variant that wraps
each in `at()` with a local gradient). Pictures: 50 placements of 10 versions,
`deps` a rebuilt 20-field object, about 30 nodes per body.

Measured: 600 frames after 60 warm-up frames, one phase per loop, in Node 25
(`--expose-gc`) and in the repo's headless Chromium 150 (page via `page.sh`).
Each phase runs alone, so timer calls do not distort tiny numbers.

## Results

Mean ms per frame. "sketch" is the sketch's own work with a do-nothing view.
All of these are on one machine (M2 Pro); the noise is about 0.1 to 0.2 ms.

### Node, object nodes (A)

| Workload | Nodes | sketch | record (extra) | hash | reuse scan | LCS diff | audit (extra) |
|---|---|---|---|---|---|---|---|
| Walker sheet | 1249 | 1.02 | 0.85 | 0.98 | 0.02 | 0.10 | none |
| Intra room | 126 | 0.04 | 0.05 | 0.04 | 0.00 | 0.01 | 3.3 |
| 5000 circles + gradients | 5000 | 0.16 | 1.12 | 1.45 | 0.07 | skipped | none |
| 5000 circles in `at()` | 10000 | 0.20 | 2.13 | 1.93 | 0.17 | skipped | none |
| 50 placements, 10 versions | 51 | 0.01 | 0.06 | 0.00 | 0.00 | 0.01 | 0.19 |

### Browser, object nodes (A)

| Workload | sketch | record (extra) | hash | reuse scan | LCS diff | audit (extra) |
|---|---|---|---|---|---|---|
| Walker sheet | 0.76 | 0.70 | 1.46 | 0.03 | 0.11 | none |
| Intra room | 0.03 | 0.03 | 0.05 | 0.00 | 0.01 | 1.9 |
| 5000 circles + gradients | 0.11 | 0.88 | 2.56 | 0.09 | skipped | none |
| 5000 circles in `at()` | 0.10 | 1.76 | 2.49 | 0.26 | skipped | none |
| 50 placements, 10 versions | 0.00 | 0.06 | 0.00 | 0.00 | 0.01 | 0.15 |

The browser timer rounds to 0.1 ms, so values near 0.1 are coarse; means over
600 frames are fair.

### Node, typed arena (B), hash included in record

| Workload | record total | of which hash | reuse scan | LCS diff | audit (extra) |
|---|---|---|---|---|---|
| Walker sheet | 2.42 | 0.26 | 0.08 | 0.13 | none |
| Intra room | 0.10 | 0.02 | 0.00 | 0.01 | 2.4 |
| 5000 circles + gradients | 1.79 | 0.27 | 0.43 | skipped | none |
| 5000 circles in `at()` | 2.56 | 0.45 | 0.50 | skipped | none |
| 50 placements | 0.07 | 0.00 | 0.01 | 0.01 | 0.21 |

### Deps comparison (pictures workload)

50 `picture()` calls per frame, each a deep compare of a 20-field object
against its cached version: **0.06 ms per frame, about 1.2 µs per call**
(Node and browser). 4990 of 5000 calls hit; the 10 misses record once. This
is the whole cost of a cache hit besides the `place` node. It is a rounding
error in the budget.

### Allocation per frame (Node, median of 25 single frames)

| Workload | sketch alone | A record | A record + hash | A, by reference | B |
|---|---|---|---|---|---|
| Walker sheet | 6.2 MB | 8.1 MB | 8.1 MB | 6.5 MB | 6.3 MB |
| Intra room | 131 KB | 264 KB | 266 KB | 185 KB | 150 KB |
| 5000 circles + gradients | 1.1 MB | 4.8 MB | 5.1 MB | 2.1 MB | 1.4 MB |
| 5000 circles in `at()` | 1.8 MB | 7.9 MB | 8.0 MB | 4.4 MB | 2.1 MB |
| 50 placements | 37 KB | 108 KB | 108 KB | 101 KB | 89 KB |
| 50 placements, audit on | | 905 KB | | | 272 KB |

Recording by value with object nodes adds 3 to 4 MB per frame at 5000 nodes.
The browser's `performance.memory` is quantized in headless Chromium and
showed no change, so allocation is a Node measurement only (same V8 engine).

### GC (Node, 600 frames, full recording loop)

| Workload | A: collections / total / worst | B: collections / total / worst |
|---|---|---|
| Walker sheet | 311 / 83 ms / 1.8 ms | 214 / 14 ms / 0.9 ms |
| 5000 circles + gradients | 223 / 90 ms / 1.1 ms | 58 / 5 ms / 0.9 ms |
| 5000 circles in `at()` | 333 / 89 ms / 2.4 ms | 75 / 5 ms / 1.7 ms |
| 50 placements | 9 / 1 ms / 0.2 ms | 8 / 1 ms / 0.3 ms |

No pause above 2.5 ms. In the browser, GC cannot be observed directly. No
frame in 600 exceeded the mean by more than about 1.5 ms for the object
recorder, apart from the `WeakSet` variant below.

### Sibling LCS worst case

When every sibling changed (the particle case), the LCS table grows with the
square of the sibling count: 500 siblings 2.6 ms, 1000 siblings 2.7 ms, 2000
siblings 10 ms; 5000 would need a 25-million-cell table. The probe caps the
table at 4 million cells and then reports "all replaced", which costs nothing.

## What dominates

- **Recording is cheap per node and cheap against the target.** Object nodes
  cost about 0.7 µs per node (walker) to 0.2 µs (particles); the worst case,
  10000 nodes, is 2.1 ms. A whole recorded frame with hashing is 2.8 to 4.6 ms
  at 5000 to 10000 nodes. That is 25 to 40 percent of the 12 ms budget, taken
  from the same JS thread, so it matters for the 5000-particle case but not for
  the walker (about 1.1 ms of recording over a 1.0 ms sketch) or rooms.
- **Capture by value is most of the recording cost.** Capturing by reference
  makes the particle frame 0.27 ms instead of 1.28 ms (walker 1.23 instead of
  1.88 ms). Most of the copying is style objects and gradient stop arrays.
- **Post-hoc hashing of an object tree costs as much as recording it** (1.0 to
  2.6 ms). Hashing while serializing into the arena costs about 0.25 ms.
- **The audit is the expensive thing, but only in testing mode.** A room's two
  picture bodies re-record 2 to 3 ms each frame; 50 small pictures cost 0.2 ms.
  Audit cost is the total size of all picture bodies, every frame.
- **Deps comparison and picture cache hits cost nothing measurable.**
- **Diff and reuse scan are cheap when the scene is mostly stable** (0.1 ms for
  the walker) and are tool-time work anyway. Only the LCS on large all-changed
  sibling lists is a trap.

## What surprised me

- The typed arena is **not faster** than object nodes: 25 to 40 percent slower
  to record in Node (walker 2.4 against 1.9 ms), because serializing strings
  and nested objects through a switch and a string table costs more than V8's
  cheap young-generation allocation. It wins on allocation (5 times less) and
  on hash cost, and on GC (about 5 times fewer collections at 5000 nodes).
- Tagging helper results (gradients) as already-owned with a `WeakSet` to skip
  copying them saved little (1.28 to 0.98 ms) and caused GC spikes of 5 ms in
  the browser. A frozen or tagged-by-symbol result might do better. Not tried.
- The walker sketch itself allocates 6 MB per frame (its own geometry). Recording
  adds under a third of that, so the sketch, not the recorder, drives GC there.
- Intra room recording is almost free, because the cached strip is two
  `picture` hits. Its audit is the big cost (2 to 3 ms), since the strips hold
  all the room's shell drawing.

## Answer for the backend choice

Recording and comparing the scene is not a reason to prefer either backend:
about 1 to 4 ms in the worst realistic case, all JavaScript, and identical for
Skia and GPU. It does take a visible share of the 12 ms budget at 5000+ nodes
per frame, so the recorder should not be naive.

Recommendations:
1. Keep draft 2.2 semantics (every call a node, value capture, value-compared
   `deps`). Nothing measured forces a change.
2. Avoid copying data the sketch cannot alias: have `v.*` helper results
   (`radialGradient`, `curvePath`, `tube`, `offset`) be frozen at creation and
   captured by reference, and copy only literals and arrays the caller owns.
   Upper bound on the saving: 0.9 ms (walker) to 1.0 to 1.9 ms (5000 nodes).
3. Compute hashes while recording, from numeric data, not by walking objects
   afterwards. A cheap rolling hash per node and per closed group costs
   about 0.25 ms at 5000 nodes. Compute it only for pictures and groups the
   renderer may cache if the saving is wanted.
4. A typed arena only pays if the renderer also reads the arena directly
   (batching dabs and instances from typed arrays). As a pure recorder it
   saves allocation, not time. Decide it with the renderer, not now.
5. Run the audit in testing mode only, as drafted. To keep it affordable, audit
   each version once per frame, not once per placement (the probe audits each
   call; the room workload audits two versions).
6. Run scene diffs only in tools (`cli diff`, `--scene`). Cap the LCS (a few
   thousand siblings) and fall back to "replaced". The renderer should use
   hash equality of subtrees by position and key, never an LCS.
7. Report `time spent comparing deps` in `--timing`: it is about 1 µs per call
   and will always be small; its absence from hot paths is the finding.

## Open problems

- No real brush or text measurement; brushed strokes will add expansion work
  that is not counted here. Stage 3 brush probes own that.
- The 12 ms budget includes the sketch, the renderer and the page. This probe
  covers only the recorder's share.
- Browser allocation and GC could not be measured (quantized
  `performance.memory`, no `gc()`). A trace with `--expose-gc` is the way.
- A first run of all workloads at once (with a 128 MB semi-space) was killed;
  the final runs use one workload per process at 16 MB and stay under 310 MB.
