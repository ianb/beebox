<!-- The brief as relayed by the driving session (the boxholder's own words are quoted in it), except that scratch-directory paths are shown as <scratch> and paths to the since-deleted gallery are named in words. -->

Make an artsy, animated showcase scene with canvas-loop, the WebGPU scene library in `canvas-loop/` of this monorepo. The boxholder asked: "get artsy with an animated scene to show things off to me. Try to use the different features (brushes, sound, etc) in maybe a Busy Town kind of scene."

**What to make.** An original busy little town, the picture-book kind: lots of small things going on at once, a feeling of a living place. It must be original: no Richard Scarry characters, names, or look-alikes. Animal or human townsfolk is your choice. Aim for something that doesn't look like lazy digital art: hand-drawn wobble, brushed ink, paper texture, painterly light. Show off as many library features as fit naturally:
- brushes (ink, dabs, bristle, smudge, whatever BRUSHES.md offers) and paper;
- effects, glow and lighting (e.g. dusk falling and windows/streetlamps lighting up, a day cycle);
- pictures (draw-once, place-many) for repeated things;
- text (shop signs);
- interactivity: clickable things with small chain reactions, hover cues, params (time of day, weather, etc.);
- sound: look at how canvas-loop does sound (`canvas-loop/sounds/`, TEA.md) and use it for clicks/events;
- smooth animation at 60 fps in the browser.

**Read first:** `canvas-loop/AGENTS.md`, then `TEA.md` (the sketch contract; `draw` returns its drawing — the returned style), `BRUSHES.md`, `README.md`, the gallery README. For prior art, look at `src/gallery/busy-town-opus/` and `src/gallery/busy-town-sol/` (older busy-town rounds, mechanically migrated) and the `intra-*` sketches (rooms, lounge-side, atrium) for hand-drawn rooms and walkers. Do something new and better looking than the older busy-town rounds, not a port.

**The loop:** write the sketch in the gallery entry busy-town-showcase (split into more `*-tea.ts` files if it gets big), render with `pnpm --dir canvas-loop run cli run src/gallery/busy-town-showcase/sketch-tea.ts --events <events.json> --out <scratch>/out`, read `transcript.md` and look at the frames, iterate. Judge by the pixels. Use an events file that clicks a few things so the frames show interactions. Iterate on the look several times; ask yourself whether a person would find it charming.

**Speed:** check it stays fast in a browser (a live page that mounts gallery sketches with `mountSketch` and shows frames/s). Target 60 at normal density. Things that don't move should be drawn once (pictures) instead of redrawn every frame; a known slow case is a large painted background redrawn per frame.

**Constraints:** one heavy GPU process at a time; don't touch library code outside the gallery folder (report gaps instead); bank it as a gallery entry and `gallery:check` must pass.
