<!-- The prompt as given, except that scratch-directory paths are shown as <scratch>. -->

You are building an educational interactive with **canvas-loop**, a deterministic Canvas2D sandbox in this repository. This repeats an earlier experiment with an improved library; for a fair comparison, do not open `canvas-loop/src/gallery/balance-reaction/`, `canvas-loop/src/gallery/periodic-trends/`, `scratch/d3-compare/` or `<scratch>/` (other than your output directory).

**The visual: a periodic trends explorer** for a learner around 14–16 years old. Show the main-group elements (groups 1, 2 and 13–18, periods 1–6; the transition metals may be shown greyed or omitted) and let the learner explore one property at a time: atomic radius, electronegativity (Pauling) or first ionization energy, chosen with a control. Show the property both as a periodic-table layout (each cell shaded or sized by the value) and as a line chart of the value across a chosen period or down a chosen group. Hovering or clicking an element shows its value and highlights it in both views. The learner should be able to see the trends (radius grows down a group and shrinks across a period; electronegativity and ionization energy the opposite way) and spot the exceptions. Use real values from standard references (a small embedded data table is fine; say where the numbers come from). Clean and readable first; this is a chart, not a painting.

**Tools.** Read `canvas-loop/AGENTS.md`, `canvas-loop/README.md`, `canvas-loop/TEA.md` and `canvas-loop/BRUSHES.md` first. Write a TEA sketch `canvas-loop/src/gallery/periodic-trends-2/sketch-tea.ts` (helper files named `<name>-tea.ts`). Controls are params (select, number with `control: "field"`, boolean, trigger); `v.control(name, box)` places a param's native input inside the drawing; `v.text(s, box, options)` writes text at a point or wraps it in a box. Pointer and keys arrive as Msgs. Script a learner's session in `canvas-loop/src/gallery/periodic-trends-2/events.json` (param changes, mousemoves, clicks, snapshots) and render from the repo root with:

    pnpm --dir canvas-loop run cli run src/gallery/periodic-trends-2/sketch-tea.ts --frames <N> --every 1000 --events src/gallery/periodic-trends-2/events.json --out <OUT>/cycle-N [--zoom x,y,w,h] [--outline]

where <OUT> is `<scratch>/d3-round2/periodic-trends-2-out`.

**Budget: up to 16 render cycles.** Stop when you are satisfied or at 16, whichever comes first. Keep `history/notes.md` (Intent and Seen per cycle) and `history/cycle-N.txt` copies in the sketch folder. Edit nothing outside the sketch folder and the output directory; do not patch the library (describe problems in your account); no git; run commands in the foreground. Before finishing, `pnpm --dir canvas-loop exec eslint src/gallery/periodic-trends-2/` must pass and `pnpm --dir canvas-loop typecheck` must report no errors in your files.

**Account.** Write `canvas-loop/src/gallery/periodic-trends-2/history/account.md`: what a learner sees and does, what was easy, what fought you (including the render-and-read loop), how many cycles you used and **why you stopped** (one of: "satisfied", "budget", "blocked: <what>"), and what you would want from the library. Reply with its text.

Choose `--frames` to cover your scripted session (60 frames = 1 second).
