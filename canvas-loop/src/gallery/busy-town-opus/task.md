<!-- The prompt as given, except that scratch-directory paths are shown as <scratch>. -->

You are making a living picture-book page with canvas-loop, a deterministic Canvas2D sandbox in this repository.

**Task.** Make a busy, cheerful town scene in the tradition of the great "busy" picture-book spreads: a whole street (or a cutaway of buildings) crowded with small animal townsfolk going about their jobs, vehicles, shops, windows, signs, and little jokes for a reader to find. Small word labels on things ("BAKERY", "mail", "bus stop") are welcome. Invent your own town and characters; do not reproduce characters or places from existing books.

The page is **alive and playful**:
- Everything idles with a small motion: someone sweeps, a flag flutters, a cat's tail flicks, smoke curls, a bus idles.
- **Click a resident or a thing and it comes alive**: it performs its little act for a few seconds (the baker pulls a loaf from the oven and steam puffs out; the bus pulls away round the corner and comes back; a window flies open and someone waters the flowers; the painter's ladder wobbles and he hangs on...), then settles back. Aim for at least 15 clickable things, each with its own act; little chain reactions between neighbours are a delight.
- Give a cue for what is clickable when the pointer is over it (a hop, a wiggle, a glint), since the cursor cannot change.
- A couple of params are welcome (time of day, rain, a "reset" trigger), but clicking is the heart of it.

**Tools.** Read `canvas-loop/README.md`, `canvas-loop/TEA.md` and `canvas-loop/BRUSHES.md` (especially "Animation and interaction"). It must be a TEA sketch: `canvas-loop/src/gallery/busy-town-opus/sketch-tea.ts`; split it into sibling helper files named `<name>-tea.ts` (import them as `./<name>-tea.js`). Paint the town with brushes, keep it painted, and keep it fast:
- `v.cache(key, body)` for the static town, keyed on any param it depends on.
- `v.sprite({ key, width, height }, body)` + `v.image(sprite, x, y)` for each character and each pose: paint it once, then move, bob, flip (`scale(-1, 1)`) and rotate it every frame under `push`/`translate`/`rotate`/`pop`.
- Draw only what changes each frame, with cheap marks.
- Target: under 16 ms per frame headless. Measure with `time pnpm --dir canvas-loop run cli run src/gallery/busy-town-opus/sketch-tea.ts --frames 121 --every 1000 --out <scratch>/busy-town-opus/timing` against `--frames 1`, and report the per-frame cost.
- Canvas up to 1000×750.

**Workspace.** Render with:

    pnpm --dir canvas-loop run cli run src/gallery/busy-town-opus/sketch-tea.ts --frames 240 --every 40 --events src/gallery/busy-town-opus/events.json --out <scratch>/busy-town-opus/cycle-N [--zoom x,y,w,h]

(Paths after `--dir canvas-loop` are relative to `canvas-loop/`.) Write `canvas-loop/src/gallery/busy-town-opus/events.json` that clicks every clickable thing, with `snapshot` entries to pin the frames that show each act; the transcript shows each click's engagement verdict, so name your handlers with `u.handled("baker")` and so on. Use `--zoom` and `cli diff` as you find useful.

**Budget: 12 render cycles.** For each cycle N, append to `canvas-loop/src/gallery/busy-town-opus/history/notes.md` a `## Cycle N` section with **Intent** (before rendering) and **Seen** (after). Copy the sketch files into `cycle-N.txt` in `canvas-loop/src/gallery/busy-town-opus/history/`.

**Rules.** Edit nothing outside `canvas-loop/src/gallery/busy-town-opus/` and `<scratch>/busy-town-opus`. Do not patch the library; describe its problems in your account. Do not run git commands. Run commands in the foreground. Before you finish, `pnpm --dir canvas-loop exec eslint src/gallery/busy-town-opus/` must pass and `pnpm --dir canvas-loop typecheck` must report no errors in your files (other gallery directories may belong to another agent working at the same time).

**Account.** Write `canvas-loop/src/gallery/busy-town-opus/history/account.md`:
- The town: who lives there, what each clickable thing does, and the chain reactions.
- The per-frame cost and how you got it there.
- What fought you (bugs, confusing API, surprises), and what you wanted and did not have.
- How you feel about the result.

Then reply with the account's text.
