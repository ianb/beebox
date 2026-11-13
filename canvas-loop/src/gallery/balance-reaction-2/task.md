<!-- The prompt as given, except that scratch-directory paths are shown as <scratch>. -->

You are building an educational interactive with **canvas-loop**, a deterministic Canvas2D sandbox in this repository. This repeats an earlier experiment with an improved library; for a fair comparison, do not open `canvas-loop/src/gallery/balance-reaction/`, `canvas-loop/src/gallery/periodic-trends/`, `scratch/d3-compare/` or `<scratch>/` (other than your output directory).

**The visual: balancing a chemical equation**, for a learner around 12–15 years old:
- A small set of reactions to choose from (a control), for example H₂ + O₂ → H₂O, CH₄ + O₂ → CO₂ + H₂O, N₂ + H₂ → NH₃, Fe + O₂ → Fe₂O₃, C₃H₈ + O₂ → CO₂ + H₂O.
- The learner **types the coefficients**: whole numbers 1–12 in native number inputs. A reaction with three species ignores the fourth field; make that clear on the canvas.
- The picture shows what the numbers mean: the equation written out with the current coefficients; each side's molecules drawn as atoms (e.g. the usual element colours) repeated by coefficient, so "2 H₂O" is two drawn water molecules; and a tally per element on each side, with the mismatch obvious (e.g. bars or counts that turn from red to green).
- When every element balances, the page says so clearly and celebrates a little (a gentle animation). When it does not, it should help the learner see which element is off, without solving it for them.
- Clean, friendly and readable; painted touches welcome, clarity first.

**Tools.** Read `canvas-loop/AGENTS.md`, `canvas-loop/README.md`, `canvas-loop/TEA.md` and `canvas-loop/BRUSHES.md` first. Write a TEA sketch `canvas-loop/src/gallery/balance-reaction-2/sketch-tea.ts` (helper files named `<name>-tea.ts`). Controls are params (select, number with `control: "field"`, boolean, trigger); `v.control(name, box)` places a param's native input inside the drawing; `v.text(s, box, options)` writes text at a point or wraps it in a box. Pointer and keys arrive as Msgs. Script a learner's session in `canvas-loop/src/gallery/balance-reaction-2/events.json` (param changes, mousemoves, clicks, snapshots) and render from the repo root with:

    pnpm --dir canvas-loop run cli run src/gallery/balance-reaction-2/sketch-tea.ts --frames <N> --every 1000 --events src/gallery/balance-reaction-2/events.json --out <OUT>/cycle-N [--zoom x,y,w,h] [--outline]

where <OUT> is `<scratch>/d3-round2/balance-reaction-2-out`.

**Budget: up to 16 render cycles.** Stop when you are satisfied or at 16, whichever comes first. Keep `history/notes.md` (Intent and Seen per cycle) and `history/cycle-N.txt` copies in the sketch folder. Edit nothing outside the sketch folder and the output directory; do not patch the library (describe problems in your account); no git; run commands in the foreground. Before finishing, `pnpm --dir canvas-loop exec eslint src/gallery/balance-reaction-2/` must pass and `pnpm --dir canvas-loop typecheck` must report no errors in your files.

**Account.** Write `canvas-loop/src/gallery/balance-reaction-2/history/account.md`: what a learner sees and does, what was easy, what fought you (including the render-and-read loop), how many cycles you used and **why you stopped** (one of: "satisfied", "budget", "blocked: <what>"), and what you would want from the library. Reply with its text.

Choose `--frames` to cover your scripted session (60 frames = 1 second).
