<!-- The prompt as given, except that scratch-directory paths are shown as <scratch>. -->

You are building an educational interactive with canvas-loop, a deterministic Canvas2D sandbox in this repository: **balancing a chemical equation**.

**Task.** A TEA sketch, `canvas-loop/src/gallery/balance-reaction/sketch-tea.ts` (helper files named `<name>-tea.ts` allowed), for a learner around 12–15 years old:
- A small set of reactions to choose from (a `select` param), for example H₂ + O₂ → H₂O, CH₄ + O₂ → CO₂ + H₂O, N₂ + H₂ → NH₃, Fe + O₂ → Fe₂O₃, C₃H₈ + O₂ → CO₂ + H₂O.
- The learner **types the coefficients**: number params with `control: "field"` (see TEA.md's params table), whole numbers 1–12. A reaction with three species ignores the fourth field; make that clear on the canvas.
- The picture shows what the numbers mean: the equation written out with the current coefficients; each side's molecules drawn as atoms (e.g. the usual element colours) repeated by coefficient, so "2 H₂O" is two drawn water molecules; and a tally per element on each side, with the mismatch obvious (e.g. bars or counts that turn from red to green).
- When every element balances, the page says so clearly and celebrates a little (a gentle animation). When it does not, it should help the learner see which element is off, without solving it for them.
- Clean, friendly and readable; painted touches welcome, clarity first.

**Read first:** `canvas-loop/README.md`, `canvas-loop/TEA.md` and `canvas-loop/BRUSHES.md`.

**Workspace.** Script a learner's session as `canvas-loop/src/gallery/balance-reaction/events.json` with `param` events (choose a reaction, type coefficients, get it wrong, fix it) and `snapshot` entries. Render with:

    pnpm --dir canvas-loop run cli run src/gallery/balance-reaction/sketch-tea.ts --frames 360 --every 1000 --events src/gallery/balance-reaction/events.json --timing --out <scratch>/balance/cycle-N

**Budget: 8 render cycles.** Keep `history/notes.md` (Intent and Seen per cycle) and `history/cycle-N.txt` copies. Rules: edit nothing outside `canvas-loop/src/gallery/balance-reaction/` and the output directory; do not patch the library (describe problems in your account); no git; foreground commands; before finishing, `pnpm --dir canvas-loop exec eslint src/gallery/balance-reaction/` must pass and `pnpm --dir canvas-loop typecheck` must report no errors in your files.

**Account.** Write `canvas-loop/src/gallery/balance-reaction/history/account.md`: what a learner sees and does, the design choices for teaching, what fought you, what the library lacked (especially for educational interactives and input controls), and the per-frame timing. Reply with its text.
