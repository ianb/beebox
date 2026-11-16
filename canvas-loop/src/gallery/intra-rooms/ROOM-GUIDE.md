# Drawing an Intra room

You are drawing rooms of Intra (the bunker in ~/src/intra-game) as hand-drawn
side-view cross-sections, in a shared kit. Read PLAN.md (this folder) first, then
`room-atrium-tea.ts` as the worked example, then kit-tea.ts, props-tea.ts,
sky-tea.ts and sizes-tea.ts. The canvas-loop sketch contract is
canvas-loop/TEA.md; brushes are canvas-loop/BRUSHES.md.

## The brief, from the boxholder

Go through the Intra rooms. Keep a similar visual language throughout; reuse
where you can. The place is a bit weird and run-down, but with attempts (often
decayed) at seeming fresh or varied. Leave little easter eggs (a Fallout nod, a
Paranoia nod, quirky little things). Have fun with it; keep it modular. 70s
imagined-modern, retrofuturistic. Each room should feel distinct despite the
shared language and vibe. Navigation is simple: people walk left and right;
exits are the room's edges, doors in the back wall, stairs you just walk up or
down, a ladder, a transit tube.

## Rules

- **Scale**: every size from sizes-tea.ts, in metres (145 px/m, people 1.65 m,
  doors 2.1 m, ceiling 3 m). `at(x, h, depth)` converts. Nothing sized by eye.
- **Exits** are in the room spec (already set in your placeholder from the
  game's map; keep them, adjust x positions if your layout needs). Every exit
  must be obvious and signed.
- **Shared language**: the kit's shell (wall in the room's colour, riveted
  plates, ceiling beam with sky-screen panels showing the room's sky, floor),
  ink outlines (`blob`, `stroke`), washes and hatching, paper grain. Every room
  has Ama's intercom (`amaSpeaker` + `amaEye` in live) and a citizen or two
  (`citizen`, collar in the room colour, a jumpsuit number). Use posters,
  pipes, vents, globe lamps, tube lights, plants, shell chairs, tulip tables,
  bunting, CRTs from props-tea.ts before drawing your own.
- **Your own pieces**: each room needs 2–4 signature pieces drawn for it, the
  things its description names, made characterful (bulging, leaning, patched).
  Put room-only painters in the room file. Something two of your rooms share
  goes in `parts-<your letter>-tea.ts`.
- **Order**: `paintWall` is drawn before the exits and the ceiling, `paintFurniture`
  after the floor and exits (so decorations on a door go in `paintFurniture`).
- **Light**: static drawing in `paintWall` / `paintFurniture` (cached once);
  anything that moves or glows in `live(v, t)`, kept cheap (well under 100 ms a
  frame). Use `glow()` for light pools. Animate something room-specific.
- **Do not edit** kit-tea.ts, props-tea.ts, sky-tea.ts, sizes-tea.ts,
  ink-tea.ts, sketch-tea.ts, rooms-tea.ts or other agents' room files, or
  anything outside this folder. If the kit has a bug or lacks something you
  need, work around it in your own file and say so in your report.
- Code: TypeScript, the TEA lint (`*-tea.ts`). No `eslint-disable`, no type
  assertions, no `Math.random`. Before reporting, from canvas-loop/:
  `pnpm exec tsc --noEmit -p . 2>&1 | grep intra-rooms` and
  `pnpm exec eslint src/gallery/intra-rooms` must show nothing for your files.

## The loop

Render one room (from canvas-loop/; the room param picks it):

```sh
mkdir -p out/room-events
echo '[{"frame":0,"type":"param","name":"room","value":"<id>"}]' > out/room-events/<id>.json
pnpm run cli run src/gallery/intra-rooms/sketch-tea.ts --events out/room-events/<id>.json --frames 61 --every 30 --out out/rooms/<id>
```

(Keep the events file outside the --out folder: each run empties --out.) Look at `out/rooms/<id>/frame-0060.png` with Read. Zoom into details with
`pnpm run cli zoom out/rooms/<id>/frame-0060.png x,y,w,h@2`. Iterate at least
three looks per room: composition and scale first, then character and detail,
then light and animation. Judge by the picture, as a stranger would see it.

## Report

For each room: what you drew (signature pieces, easter eggs, animation), the
exits and where they are, anything left rough, and any kit problems you hit.
Keep it short.
