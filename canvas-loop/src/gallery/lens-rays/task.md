<!-- The prompt as given, except that scratch-directory paths are shown as <scratch>. -->

You are one side of a head-to-head comparison between two ways of building educational interactives: **canvas-loop** (a deterministic Canvas2D sandbox in this repository) and **d3**. You build the **canvas-loop** side; another agent builds the same visual in d3 at the same time. Do not open `<scratch>/` (other than your output directory) or `scratch/d3-compare/`.

**The visual: a thin-lens ray diagram** for a learner around 15–17 years old. A converging lens on an optical axis, its two focal points marked (F and F′) and 2F marked. An upright object arrow the learner can **drag** left and right along the axis (and change its height). The learner **types the focal length** in centimetres (a number input, 5–30) and can switch to a diverging lens. Draw the three principal rays from the object's tip (parallel then through F′; through the centre undeviated; through F then parallel), extended as dashed lines where the image is virtual, and the image arrow where they meet, labelled real/virtual, upright/inverted, magnified/diminished. Show the numbers: object distance u, image distance v, magnification, and the thin-lens equation with those numbers substituted. The case where the object is at F (no image) must be handled sensibly. Clean and readable, like a good textbook figure.

**Tools.** Read `canvas-loop/AGENTS.md`, `canvas-loop/README.md`, `canvas-loop/TEA.md` and `canvas-loop/BRUSHES.md` first. Write a TEA sketch `canvas-loop/src/gallery/lens-rays/sketch-tea.ts` (helper files named `<name>-tea.ts`). Controls are params (select, number with `control: "field"`, boolean, trigger); `v.control(name, box)` places a param's native input inside the drawing; `v.text(s, box, options)` writes text at a point or wraps it in a box. Pointer and keys arrive as Msgs. Script a learner's session in `canvas-loop/src/gallery/lens-rays/events.json` (param changes, mousemoves, clicks, snapshots) and render from the repo root with:

    pnpm --dir canvas-loop run cli run src/gallery/lens-rays/sketch-tea.ts --frames <N> --every 1000 --events src/gallery/lens-rays/events.json --out <OUT>/cycle-N [--zoom x,y,w,h] [--outline]

where <OUT> is `<scratch>/d3-round2/lens-rays-out`.

**Budget: up to 16 render cycles.** Stop when you are satisfied or at 16, whichever comes first. Keep `history/notes.md` (Intent and Seen per cycle) and `history/cycle-N.txt` copies in the sketch folder. Edit nothing outside the sketch folder and the output directory; do not patch the library (describe problems in your account); no git; run commands in the foreground. Before finishing, `pnpm --dir canvas-loop exec eslint src/gallery/lens-rays/` must pass and `pnpm --dir canvas-loop typecheck` must report no errors in your files.

**Account.** Write `canvas-loop/src/gallery/lens-rays/history/account.md`: what a learner sees and does, what was easy, what fought you (including the render-and-read loop), how many cycles you used and **why you stopped** (one of: "satisfied", "budget", "blocked: <what>"), and what you would want from the library. Reply with its text.

Choose `--frames` to cover your scripted session (60 frames = 1 second).
