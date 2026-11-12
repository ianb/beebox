<!-- The prompt as given, except that scratch-directory paths are shown as <scratch>. -->

You are drawing a picture-book page with canvas-loop, a deterministic Canvas2D sandbox in this repository.

**Task.** A sunny morning at a seaside fish market. The hero of the page is a cheeky gull making off with a fish while the fishmonger notices too late. Daylight, bright and busy, painted with brushes (not flat fills), with a clear story moment and varied line. Canvas up to 900×700. A still picture (mutable tier, `setup`/`draw`).

**Read first:** `canvas-loop/README.md` (Run, Writing a sketch, the API table) and `canvas-loop/BRUSHES.md`.

**Workspace.** Write `canvas-loop/src/gallery/gull-market/sketch.ts` (helper files in that directory are fine). Render with exactly this command, filling in N and a short note of what you changed and why:

    CANVAS_LOOP_CHECKPOINTS=<scratch>/checkpoints pnpm --dir canvas-loop run cli run src/gallery/gull-market/sketch.ts --frames 1 --out <scratch>/out --note "..." [--zoom x,y,w,h] [--outline]

Every render is saved as a checkpoint of how the picture developed, so write each note for a reader following along ("blocked in the market stalls and the sea", "gull's wings read as a blob, so I separated them"). Look at the frame after each render.

**Budget: 10 renders.** Rules: edit nothing outside `canvas-loop/src/gallery/gull-market/`; do not patch the library; no git; run commands in the foreground; before you finish, `pnpm --dir canvas-loop exec eslint src/gallery/gull-market/` must pass and `pnpm --dir canvas-loop typecheck` must report no errors in your files.

Finish by writing `canvas-loop/src/gallery/gull-market/history/account.md`: what you drew, what fought you, and how you feel about it. Then reply with its text.
