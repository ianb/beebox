<!-- The brief as relayed by the driving session (the boxholder's own words are quoted in it), except that scratch-directory paths are shown as <scratch> and paths to the since-deleted gallery are named in words. -->

Make a silly little game with canvas-loop, the WebGPU scene library in `canvas-loop/` of the monorepo.

**The boxholder's ask:** "Let's make a silly little game. Like maybe in the style of Plants vs Zombies (vaguely tower defense) but with a strong alternate painterly aesthetic."

**Design constraints:**
- An original game in the lane-defense / tower-defense genre: a grid of lanes, defenders you place with a resource, waves of silly attackers coming down the lanes. It must be original: no Plants vs. Zombies plants, zombies, names, sun currency, lawn/house setup, or look-alikes. Invent your own premise, cast, and currency, with a sense of humour.
- A strong, distinct painterly aesthetic: pick one art direction and commit to it (e.g. gouache picture book, sumi-e ink wash, woodcut/linocut, stained glass, crayon on kraft paper). Use canvas-loop's brushes, paper, effects, glow and lighting to make it look painted, not like flat vector game art.
- Playable and fun for a few minutes: 3–5 defender types with distinct roles, 3+ attacker types, a few waves escalating, a win and a lose state, restart. Juice: hits, particles, squash-and-stretch, small screen shake, sound for placements, hits, wave starts, win/lose.
- 60 fps in the browser. Draw unchanging things (the board, the painted background) once as pictures; one picture per animation pose.

**Read first:** `canvas-loop/AGENTS.md`, `TEA.md`, `BRUSHES.md`, `README.md`, the gallery README; the busy-town-showcase gallery entry for patterns (don't copy its look).

**The loop:** write it in `canvas-loop/src/gallery/lane-defense/`, render with the CLI, read `transcript.md`, look at the frames, iterate. Script a play-through as an events file so frames show real gameplay; also check the win and lose states. Judge by the pixels whether a person would find it charming and readable.

**Live check:** mount it on the walks-now page (`<scratch>/walks-now/page.ts`) and read the frames/s readout after ~6 s and mid-wave.

**Constraints:** one heavy GPU command at a time under the GPU lock; no library changes outside the gallery folder (report gaps with the smallest repro); bank it as a gallery entry; `gallery:check` must pass.
