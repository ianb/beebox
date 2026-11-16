# Stage 3 probe brief (shared by every probe)

Part of `beebox/docs/implemented-plans/canvas-loop-scene.md`, Stage 3: small runnable
probes of the hardest rendering mechanisms, before the backend is chosen.
Read first: the plan (principles, Checkpoint 0 and 1 decisions),
`scene-api-draft.md` (draft 2.2; its lowering contract is what a renderer must
do), `coverage-matrix.md` (your rows), `parity-criteria.md` (how results are
judged), and `browser-profile.md` (where time goes today).

## Rules

- **Throwaway code.** Work in `scratch/stage3/<probe>/` (gitignored). Do not
  edit `canvas-loop/src/` or anything tracked except your results note. You may
  import canvas-loop's source (for example its brush expansion code) into a
  probe page; esbuild bundles it.
- **Harness:** `scratch/stage3/harness/README.md`. All browser use goes through
  `page.sh` or `capture.sh` (they hold a lock; other probes share the
  browser). Never call `bin/browse` directly.
- **The browser** is the repo's headless Chromium: WebGPU on Apple Metal (M2
  Pro), WebGL2 available. Pages are served from the exhibit directory over
  `http://127.0.0.1:3230/...` (a secure context). Libraries for candidate
  backends may load from `https://cdn.jsdelivr.net/npm/...` with exact
  versions.
- **The reference** is today's canvas-loop headless renderer (Skia): write a
  small canvas-loop sketch that draws the same content and render it with
  `pnpm --dir canvas-loop run cli run <sketch> --frames 1 --every 1 --out <dir>`.
  Compare with `compare.ts`.
- **Measure** at pixel ratio 1 and 2: draw time per frame (GPU work included:
  wait on `device.queue.onSubmittedWorkDone()` or read one pixel), mean and
  95th percentile over at least 120 frames after warm-up. Note anything that
  stalls.
- **Repeatability:** render the same frame twice in the browser and compare
  (parity criteria, section 1).
- **Long commands run in the foreground.** No background jobs.

## Deliver

1. A results note: `beebox/docs/plans/canvas-loop-scene/stage3/<probe>.md`,
   Simplified Technical English, short sentences, no numeric confidence
   scores. Sections: question; what was built (approach, in a paragraph);
   results against `parity-criteria.md` (tables); timing; what surprised you;
   the answer for the backend choice; open problems. Repo-relative paths only.
2. An exhibit of the comparisons, for the boxholder to see as the work goes:
   `bin/exhibits add --title "<probe>: …" --prose "…" --caption "…" <images…>`
   from the repo root. Side-by-side crops (today's Skia on the left, the probe
   on the right, labelled in the caption) and any timing chart. Captions say
   what a person sees, not code names.
3. A final reply: the exhibit URL on the first line, then a 10-line summary.

Do not commit. The driver commits the notes.
