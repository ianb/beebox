<!-- The prompt as given, except that scratch-directory paths are shown as <scratch>. -->

You are bringing a painted picture-book page to life with canvas-loop, a deterministic Canvas2D sandbox in this repository. The page already exists as a still sketch: `canvas-loop/src/gallery/open-opus-a/` (`sketch.ts` and any helper files; `history/account.md` is its author's account). Read that code; you may copy it.

**Task.** Make the page **animated and interactive**, in the spirit of its story:
- **Animate**: things that would move in this scene move (water, light, creatures, weather, small life), as a gentle loop of a few seconds. Restraint beats busyness.
- **Interact**: a reader can do something meaningful with the pointer (click, drag, hover via mousemove) and with a few params (e.g. time of dusk, wind, a toggle). Choose interactions that fit the story moment.
- Keep the painted look of the original.

**It must be a TEA sketch** so it runs in the browser figure: write `canvas-loop/src/gallery/nell-anim/sketch-tea.ts` (helper files allowed in that directory). Read `canvas-loop/TEA.md` (contract, `Msg`, params, events, the lint discipline for `*-tea.ts`) and `canvas-loop/BRUSHES.md`, especially "Animation and interaction".

**Performance matters.** Brush marks are slow: the still page takes about 1–2 s per frame headless. A browser figure needs roughly 30 ms per frame or less. Use `v.cache(key, body)` for everything static (and key it on any param it depends on), draw only the moving parts each frame, and prefer cheap marks (plain shapes, gradients, few brush marks) for what moves. Measure: `time pnpm --dir canvas-loop run cli run src/gallery/nell-anim/sketch-tea.ts --frames 61 --every 1000 --out <scratch>/nell-anim/timing` against `--frames 1`; report the per-frame cost.

**Workspace.** Render with:

    pnpm --dir canvas-loop run cli run src/gallery/nell-anim/sketch-tea.ts --frames 120 --every 20 --events canvas-loop/src/gallery/nell-anim/events.json --out <scratch>/nell-anim/cycle-N [--zoom x,y,w,h]

Write `canvas-loop/src/gallery/nell-anim/events.json` to demonstrate the interactions (clicks, drags, param changes, with `snapshot` entries to pin the frames that show them). Read `<scratch>/nell-anim/cycle-N/transcript.md`; it shows frames and the engagement verdict of each event. `cli diff` between frames can show what moved.

**Budget: 10 render cycles.** For each cycle N, append to `canvas-loop/src/gallery/nell-anim/history/notes.md` a `## Cycle N` section with **Intent** (before rendering) and **Seen** (after). Copy the sketch files into `cycle-N.txt` in `canvas-loop/src/gallery/nell-anim/history/`.

**Rules.** Edit nothing outside `canvas-loop/src/gallery/nell-anim/` and `<scratch>/nell-anim`. Do not patch the library; describe its problems in your account. Do not run git commands. Run commands in the foreground. Before you finish, `pnpm --dir canvas-loop exec eslint src/gallery/nell-anim/` must pass and `pnpm --dir canvas-loop typecheck` must report no errors in your files (other gallery directories belong to other agents working at the same time).

**Account.** Write `canvas-loop/src/gallery/nell-anim/history/account.md`:
- What moves and what the reader can do, and why those choices.
- The per-frame cost you measured, and what you did to get there.
- What fought you: bugs, confusing API, surprises (TEA, cache, brushes in motion, events).
- What you wanted and did not have, for animation and interaction.
- How you feel about the result.

Then reply with the account's text.
