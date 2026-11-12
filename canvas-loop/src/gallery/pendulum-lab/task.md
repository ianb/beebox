<!-- The prompt as given, except that scratch-directory paths are shown as <scratch>. -->

You are one side of a head-to-head comparison between two ways of building educational interactives: **canvas-loop** (a deterministic Canvas2D sandbox in this repository) and **d3**. You build the **canvas-loop** side; another agent builds the same visual in d3 at the same time. Do not open `<scratch>/` (other than your output directory) or `scratch/d3-compare/`.

**The visual: a pendulum lab** for a learner around 13–16 years old. A pendulum swings (smooth, believable animation; small-angle motion is fine). The learner sets the **string length** (typed, 0.1–2.0 m) and the **gravity** (a choice: Earth, Moon, Mars, Jupiter), and can set the release angle. A "time 10 swings" button runs a trial: the pendulum is released, a stopwatch counts, and after 10 full swings the measured period is added to a results table and plotted on a graph of period against length. Over several trials the learner should see that period grows with the square root of length and does not depend on the release angle (for small angles); offer a way to show the theory curve T = 2π√(L/g) over the measured points. Keep the trial history when settings change; allow clearing it. Clean and readable; a little life in the drawing is welcome.

**Tools.** Read `canvas-loop/AGENTS.md`, `canvas-loop/README.md`, `canvas-loop/TEA.md` and `canvas-loop/BRUSHES.md` first. Write a TEA sketch `canvas-loop/src/gallery/pendulum-lab/sketch-tea.ts` (helper files named `<name>-tea.ts`). Controls are params (select, number with `control: "field"`, boolean, trigger); `v.control(name, box)` places a param's native input inside the drawing; `v.text(s, box, options)` writes text at a point or wraps it in a box. Pointer and keys arrive as Msgs. Script a learner's session in `canvas-loop/src/gallery/pendulum-lab/events.json` (param changes, mousemoves, clicks, snapshots) and render from the repo root with:

    pnpm --dir canvas-loop run cli run src/gallery/pendulum-lab/sketch-tea.ts --frames <N> --every 1000 --events src/gallery/pendulum-lab/events.json --out <OUT>/cycle-N [--zoom x,y,w,h] [--outline]

where <OUT> is `<scratch>/d3-round2/pendulum-lab-out`.

**Budget: up to 16 render cycles.** Stop when you are satisfied or at 16, whichever comes first. Keep `history/notes.md` (Intent and Seen per cycle) and `history/cycle-N.txt` copies in the sketch folder. Edit nothing outside the sketch folder and the output directory; do not patch the library (describe problems in your account); no git; run commands in the foreground. Before finishing, `pnpm --dir canvas-loop exec eslint src/gallery/pendulum-lab/` must pass and `pnpm --dir canvas-loop typecheck` must report no errors in your files.

**Account.** Write `canvas-loop/src/gallery/pendulum-lab/history/account.md`: what a learner sees and does, what was easy, what fought you (including the render-and-read loop), how many cycles you used and **why you stopped** (one of: "satisfied", "budget", "blocked: <what>"), and what you would want from the library. Reply with its text.

Choose `--frames` to cover your scripted session (60 frames = 1 second).
