<!-- The prompt as given, except that scratch-directory paths are shown as <scratch>. -->

You are building a small paint program with canvas-loop, a deterministic Canvas2D sandbox in this repository. Keep it simple: the point is to show that painting works, not to be feature-complete.

**Task.** A TEA sketch (`canvas-loop/src/gallery/paint-simple/sketch-tea.ts`, helper files named `<name>-tea.ts` allowed) where a person paints by dragging with the mouse:
- Choose a brush (some of the presets: ink, pencil, marker, bristle, wash) and a colour from a small palette, and a size. Params are fine for this, or an on-canvas palette you click; your choice.
- Drag to paint a stroke with that brush. There is no pen pressure; derive pressure from pointer speed (faster = thinner) or a taper, whichever looks better.
- Strokes live in the model as plain data (brush, colour, size, points). That list is the drawing.
- A "clear" trigger. Undo is optional.
- Keep it responsive: finished strokes should be drawn once and kept (`v.cache` keyed on the stroke count, or similar), and only the stroke in progress redrawn each frame. Measure with `--timing`.
- Canvas about 800×560, a paper-coloured background.

**Read first:** `canvas-loop/README.md`, `canvas-loop/TEA.md` (Msg, params, events, engagement verdicts) and `canvas-loop/BRUSHES.md`.

**Workspace.** Script a little drawing as `canvas-loop/src/gallery/paint-simple/events.json`: several drags (mousedown, a series of mousemove, mouseup) with different brushes and colours chosen along the way, a clear, then a couple more strokes, with `snapshot` entries at the interesting moments. Render with:

    pnpm --dir canvas-loop run cli run src/gallery/paint-simple/sketch-tea.ts --frames 300 --every 1000 --events src/gallery/paint-simple/events.json --timing --out <scratch>/paint/cycle-N

**Budget: 6 render cycles.** Keep `history/notes.md` (Intent and Seen per cycle) and `history/cycle-N.txt` copies as in earlier rounds. Rules: edit nothing outside `canvas-loop/src/gallery/paint-simple/` and the output directory; do not patch the library (describe problems in your account); no git; foreground commands; before finishing, `pnpm --dir canvas-loop exec eslint src/gallery/paint-simple/` must pass and `pnpm --dir canvas-loop typecheck` must report no errors in your files.

**Account.** Write `canvas-loop/src/gallery/paint-simple/history/account.md`: how it works, the stroke data format, per-frame timing, what fought you, what the library lacks for a paint program. Reply with its text.
