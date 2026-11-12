<!-- The prompt as given, except that scratch-directory paths are shown as <scratch>. -->

You are drawing a picture with canvas-loop, a deterministic Canvas2D sandbox in this repository, as part of an experiment on how agents draw with brushes. Your written account at the end matters as much as the picture.

**Task.** Draw the friendly green alien in the guide image as a picture-book illustration: ink outlines, with pencil or bristle-brush shading and colour. Follow the guide for pose and proportion, and make it pretty. The guide image is `<scratch>/guide/frame-0000.png`; look at it with Read. Do not open `canvas-loop/src/examples/alien-reference-tea.ts` (the guide's source code) or any other `canvas-loop/src/gallery/alien-*` directory.

**Path form (the experimental condition).** Draw every outline with `s.path(commands)` with `"bezier"` and `"quad"` commands (control points you place yourself). Shading and texture marks may use any shape.

**Read first:** `canvas-loop/README.md` (the Run and "Writing a sketch" sections, the Sketch API table) and `canvas-loop/BRUSHES.md` (brushes, gestures, paper, groups). Use the mutable tier (`setup`/`draw`), a 400×500 canvas.

**Workspace.** Write `canvas-loop/src/gallery/alien-bezier/sketch-tea.ts`. Render with:

    pnpm --dir canvas-loop run cli run src/gallery/alien-bezier/sketch-tea.ts --frames 1 --out <scratch>/alien-bezier/cycle-N

then Read `<scratch>/alien-bezier/cycle-N/frame-0000.png`.

**Budget: 6 render cycles.** For each cycle N:
1. Before rendering, append to `canvas-loop/src/gallery/alien-bezier/history/notes.md` a `## Cycle N` section with an **Intent** line: what you changed and why.
2. Render, copy the sketch to `cycle-N.txt` in `canvas-loop/src/gallery/alien-bezier/history/`, and look at the frame.
3. Add a **Seen** line under that cycle: what you see in the frame, concretely, including whether the change helped.

This record will be used to study how agents judge their own changes, so be concrete and honest.

**Rules.** Edit nothing outside `canvas-loop/src/gallery/alien-bezier/` and `<scratch>/alien-bezier`. If the library has a bug or a confusing behaviour, work around it if you can and describe it in your account; do not patch the library. Do not run git commands. Before you finish, `pnpm --dir canvas-loop exec eslint src/gallery/alien-bezier/sketch-tea.ts` must pass; fix lint in your sketch only. Run commands in the foreground.

**Account.** Finish by writing `canvas-loop/src/gallery/alien-bezier/history/account.md`:
- What fought you: bugs, confusing API, surprises. Be specific (what you wrote, what you expected, what happened).
- What you wanted and did not have.
- The path form: how it was to specify outlines this way, and whether you would choose it again.
- Whether you could judge brush texture and edges from the frame as rendered.
- How you feel about the process and about the result.

Then reply with the account's text and the path of your final frame.
