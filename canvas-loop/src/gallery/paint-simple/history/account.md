# paint-simple: account

## How it works

`sketch-tea.ts` is a TEA sketch, 800×560, paper `#f4eedf`. Params: `brush` (ink, pencil, marker, bristle, wash), `colour` (black, red, blue, green, ochre), `size` (S/M/L), and two triggers, `clear` and `undo`. A chip in the top-right shows the current choice.

- `mousedown` inside the canvas starts a stroke from the current params (verdict `stroke-start`). The mode becomes `{ type: "painting", stroke }`.
- `mousemove` while painting appends the point if it is at least 2 px from the last one. Moves while idle return the same model, so hover reads `(unhandled)`.
- `mouseup` appends the last point and moves the stroke into `strokes` (`stroke-end`).
- `clear` empties `strokes` and bumps `page`; `undo` drops the last stroke.

Size maps to a width per brush (ink 4/8/14, pencil 3/4.5/6, marker 10/16/24, bristle 16/28/40, wash 24/44/70), because one pixel number cannot suit both pencil and wash.

**Pressure from speed.** Events arrive once per mousemove, so the gap between consecutive points stands in for speed. Each point's pressure is `1 − 0.6 × clamp((speed − 3) / 23)`, so it is 1 at ≤3 px/event and 0.4 at ≥26 px/event. The values are smoothed over neighbours and passed as `gesture({ pressure: [[t, p], …] })` keyframes at each point's arc-length fraction. A 14 px taper-in always applies; a 26 px taper-out applies only once the stroke is finished, so the live end does not flick while you draw. Finishing a stroke changed only the last ~24 px (`cli diff` of the two frames: 139 px). Each stroke carries its own `seed`, so its texture does not change as points are added or as other strokes come and go.

## Stroke data

```ts
interface Stroke {
  brush: "ink" | "pencil" | "marker" | "bristle" | "wash";
  colour: string;        // resolved hex, e.g. "#c23b2a"
  width: number;         // px at full pressure
  seed: number;          // gesture seed, never reused
  points: readonly (readonly [number, number])[];
}
Model = { strokes: Stroke[]; page: number; nextSeed: number; mode: idle | painting{stroke} }
```

Pressure is not stored; it is derived from `points` at draw time. `strokes` is the whole drawing.

## Caching and timing

Finished strokes are drawn into a chain of caches: `page-<page>-<n>` pastes `page-<page>-<n−1>` and adds stroke n (`v.cache` called inside a `v.cache` body works). Finishing a stroke therefore paints one stroke. Undo returns to a layer that is still cached. Each frame pastes the top layer and draws only the stroke in progress with the chip. `page` in the key keeps a cleared page from reusing old layers.

`--timing`, 300 frames, 21 strokes over two pages (7 on the first, 14 on the second):

| | draw avg | draw p95 | draw max | update avg |
| --- | --- | --- | --- | --- |
| chained cache (cycle 4) | 2.3 ms | 5.2 ms | 91 ms | 0.01 ms |
| flat cache, same events (cycle 5) | 2.9 ms | 10.9 ms | 91 ms | 0.01 ms |
| final (cycle 6) | 2.4 ms | 5.8 ms | 72 ms | 0.02 ms |

The flat variant, where each layer redraws paper plus all strokes, produced byte-identical frames and doubled p95, because every stroke-finish frame repaints the page. The max is one expensive frame in both versions. I could not tell which one; the likeliest candidate is a frame of the 70 px wash. Single-frame numbers are noisy: frame 0 (an empty page) took 28, 115 and 50 ms in three runs of the same work.

## What fought me

- **Snapshot ordering.** A `snapshot` and a `trigger` on the same frame capture the frame after the trigger, so my "first page" snapshot showed the page after undo. I lost a cycle to this. The fix was to put them on different frames. This follows from the frame-N rule, but nothing in the transcript flags it.
- **Width vs pressure.** At the ink preset's `thinning: 0.75`, a stroke drawn at average speed is about half its nominal width. Size L ink first came out about 5 px. I had to widen the table and narrow the pressure range (minimum 0.3 → 0.4) before size and speed both read.
- **Speed is per event, not per time.** With one scripted move per frame this is fine. In a browser, several mousemoves can land in one frame or the rate can vary, and then "speed" means event spacing. The Msg carries no timestamp. A sketch could record the last `tick` frame in the model, but events inside one frame would still tie.
- **Every event frame is captured.** One mousemove per frame means the transcript holds ~250 images, and the labelled snapshots get lost among them. For a paint script, `--every 1000` does not keep the image count down.

## What the library lacks for a paint program

- **Per-frame timing by frame.** `--timing` gives avg/p95/max only. Without the frame number of the max (or a per-frame line on request), I could not attribute the 72–91 ms spike.
- **No timestamp or pressure on pointer Msgs.** Speed-to-pressure has to guess from point spacing. Real pen pressure (`PointerEvent.pressure`) has no channel.
- **No "append to a cached layer" primitive.** The chained `cache` works, but it is a workaround for an incremental layer you can draw onto: each finished stroke costs a new cache entry, and with the 24-key limit, undo past ~24 strokes rebuilds from the nearest kept layer, recursively. A long session would need one key per checkpoint, managed by hand.
- **Bristle dry-out at the tail** shows as separate square dabs in a row beside the stroke (zoom on the blue arc's end), which reads as a dotted line more than dry bristles.
- **No eraser brush.** `erase()` exists, but a paint program would want "eraser" as a brush with the same stroke data. I would add it as a per-stroke `erase` flag that wraps the mark in `erase()`/`noErase()` inside the cached layer. I did not try it.
- **Params panel only.** Choosing a colour or brush on the canvas would mean drawing my own palette and hit-testing it. That is doable, but a common case for paint.
