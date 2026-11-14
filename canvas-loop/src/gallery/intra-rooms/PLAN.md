# Intra rooms, side view — working plan

Every room of Intra (~/src/intra-game, `lib/game/content/rooms.ts`, `quarters.ts`)
drawn as a hand-drawn side-view cross-section in canvas-loop, in one visual
language, from a shared kit. Started 2026-11-14 at the boxholder's request
("go through the Intra rooms … keep a similar visual language … reuse … modular …
70s imagined-modern, retrofuturistic, weird and run-down, decayed attempts at
freshness, easter eggs").

## Scale (from intra-lounge-side/sizes-tea.ts)

145 px per metre at every depth. Back wall foot at y = 600 (canvas 1280 × 760).
Each metre out from the wall: 34 px lower. Planes: wall props 0.35 m, furniture
1.4 m, walking line 2.6 m, foreground 3.4 m. Ceiling 3.0 m unless a room says
otherwise (Atrium 4.0). Woman 1.65, door 0.9 × 2.1, sofa back 0.85, etc.
Rooms wider than the canvas (Hallway) pan with the walker.

## Navigation

People walk left and right on the walking line. Exits:

- **edge**: walk off the left or right edge (an open passage or a door in the
  side wall, drawn at the edge with a sign).
- **door**: a door in the back wall, anywhere along it.
- **stairs**: a flight at one side going up or down to a door; you just walk up.
- **ladder / tube**: a ladder to a ceiling hatch, or a transit tube (a booth that
  takes you elsewhere: the "staircase in the wall").

Directions follow intra-game's `app/maplayout.ts`: west → left edge, east →
right edge, north/south → back-wall doors (some as stairs or tubes for variety).

## Inventory: exits per room

| Room | Map | Exits (count) | Plan |
| --- | --- | --- | --- |
| Intake | 0,2 | Foyer (1) | right edge door |
| Foyer | 1,2 | Intake, Atrium (2) | left door "Intake", right door "Hollow Atrium", signs above (per description) |
| Hollow Atrium | 2,2 | Foyer, Archive Lounge, Activity Hub, Solitude Cubes, Hallway (5) | left edge Foyer; right edge Activity Hub; back arches Hallway (N) and Archive Lounge (NE); stairs down at front-left for Solitude Cubes (S) |
| Hallway | 2,1 | Atrium, Reflection Chamber, 12 quarters (14) | wide, pans; left edge Atrium; 12 quarters doors on back wall; heavy door right end Reflection Chamber |
| Archive Console | 3,0 | Archive Lounge (1) | ladder/stairs down at left |
| Archive Lounge | 3,1 | Atrium, Pool, Console (3) | left arch Atrium; right door Pool; ladder up to ceiling hatch Console |
| Tranquil Pool | 4,1 | Archive Lounge, Joyous Cafe (2) | left edge Lounge; back door Cafe (S) |
| Joyous Cafe | 4,2 | Pool, Activity Hub (2) | back door Pool (N); left edge Activity Hub |
| Activity Hub | 3,2 | Atrium, Cafe (2) | left edge Atrium; right edge Cafe |
| Yellow Room | 1,3 | Solitude Cubes (1) | right edge door |
| Solitude Cubes | 2,3 | Yellow Room, Ill-Fitting Lounge, Waiting Room, Atrium (4) | left edge Yellow; right edge Waiting; stairs up Atrium (N); back door Ill-Fitting (S) |
| Waiting Room | 3,3 | Solitude Cubes (1) | left edge door |
| Static Garden | 1,4 | Ill-Fitting Lounge (1) | right edge |
| Ill-Fitting Lounge | 2,4 | Cubes, Quiet Plaza, Static Garden (3) | left edge Garden; back door Cubes (N); transit tube Quiet Plaza (S) |
| Feedback Booth | 1,5 | Quiet Plaza (1) | right edge door |
| Quiet Plaza | 2,5 | Feedback Booth, Ill-Fitting Lounge, Nursery (3) | left edge Booth; stairs up Ill-Fitting (N); right edge Nursery |
| Nursery | 3,5 | Quiet Plaza (1) | left edge |
| Reflection Chamber | 5,4 | Utility Closet, Hallway (2) | left door Hallway (opens from this side); open passage right to Closet |
| Utility Closet | 5,5 | Reflection Chamber (1) | left passage |
| Quarters × 12 | — | Hallway (1) | one template room, left door; dressed per occupant |

## Visual language (shared)

- Ink: wobbly hand-inked outlines, washes, pencil hatching, paper grain (ink-tea).
- Shell: back wall in the room's own colour (intra-game's Tailwind colour, faded),
  riveted metal plates along the bottom, a ceiling beam holding sky-screen panels
  showing the room's sky (each room's description names it), some panels dead.
- Everywhere: pipes and conduit, a round Ama intercom grille with a pulsing eye,
  vents, light fixtures (globe lamps, flickering tubes), posters and signage.
- 70s retrofuturism: rounded plastic, chrome, globe lamps, shell chairs, tulip
  tables, orange/avocado/harvest gold accents, CRTs, molded panels.
- Decay with attempts at freshness: half-finished bright repaint stripes,
  faded bunting, plastic flowers, taped cracks, a "NEW!" sticker on old things.
- Easter eggs: Paranoia ("Happiness is mandatory", "Trust Ama", clearance
  colours), Fallout-ish thumbs-up mascot and jumpsuit numbers, small jokes.
- People: citizens in jumpsuits with a number, collar in their room colour.

## Kit (kit-tea.ts and friends)

Room spec → painter. A spec gives width (m), wall colour, sky kind, floor kind,
exits, and props (kind, x in metres, plane, options). Rooms add their own
painters for signature pieces. Static parts are cached; skies, glows, screens,
Ama's eye and the walker animate.

## Status

All 19 rooms and 12 quarters drawn and rendering (driver: kit, Atrium, Hallway;
helper agents: the rest, per ROOM-GUIDE.md). Shared helpers per batch live in
parts-a/b/c-tea.ts. Exhibit: "Intra, every room, from the side".

Rough edges noted by the batches: seated citizens sit a little high; there is no
lying pose (nappers are drawn as heads under blankets); some small text is tiny;
the Archive Lounge copies the intra-lounge-side painters rather than sharing them
(a sketch may import only sibling files).

## canvas-loop gaps this exposed

- `v.cache` pastes where it was first drawn, so a cached scene cannot pan; the
  rooms cache as a strip of sprites instead.
- Sprites cannot be larger than the canvas, and render at device pixel ratio,
  ignoring the current zoom.
- A sprite strip's edge cuts marks, which then trip the faint-mark warning.
- No supported per-pixel drawing (several sketches use v.ctx putImageData) and no
  affine/skew `at` (slanted screens use v.ctx.transform).
- Each `run` empties `--out`, so an events file kept there disappears.
