// The recorded sounds a `sample` voice can name. Each name has one or more
// variants (takes of the same sound). The recordings are Kenney's CC0 audio
// packs (kenney.nl); the originals are in `canvas-loop/sounds/kenney/`, and
// `src/headless/sound-library-build.ts` (`pnpm sounds:build`) turns them into
// `bundled.generated.ts`.
//
// Names say what a sound is or means, so an agent that cannot hear can pick
// one from its description. This file holds no audio, so validation and docs
// can use it without loading the data.

export interface SampleEntry {
  /** What it sounds like and what it suits; shown in TEA.md. */
  readonly description: string;
  /** Source files, relative to `canvas-loop/sounds/kenney/`; one per variant. */
  readonly sources: readonly string[];
}

const I = "interface-sounds/";
const M = "impact-sounds/";
const R = "rpg-audio/";
const C = "casino-audio/";
const D = "digital-audio/";
const J = "music-jingles/";

function takes(prefix: string, numbers: readonly string[]): string[] {
  return numbers.map((n) => `${prefix}${n}.ogg`);
}

export const SAMPLES = {
  ding: { description: "a short, clear glass ding: a correct answer, a match, a small reward", sources: takes(`${I}glass_00`, ["2", "3", "5", "6"]) },
  chime: { description: "a longer glassy chime that rings out: an arrival, a finished step", sources: takes(`${I}glass_00`, ["1", "4"]) },
  bell: { description: "a struck metal bell: an alarm, a timer done, a round over", sources: takes(`${M}impactBell_heavy_00`, ["2", "3", "4"]) },
  confirm: { description: "a soft rising two-note confirmation: saved, accepted, done", sources: takes(`${I}confirmation_00`, ["1", "2", "3", "4"]) },
  error: { description: "a low buzzy 'no': a wrong answer, a blocked move", sources: takes(`${I}error_00`, ["1", "2", "4", "3"]) },
  question: { description: "a short questioning blip: a hint, a prompt to look", sources: takes(`${I}question_00`, ["1", "2", "3", "4"]) },
  click: { description: "a crisp button click: pressing a control", sources: takes(`${I}click_00`, ["1", "2", "3", "4", "5"]) },
  tick: { description: "a tiny tick, quieter than a click: a counter step, a clock, a slider notch", sources: takes(`${I}tick_00`, ["1", "2", "4"]) },
  select: { description: "a light selection blip: picking an item", sources: takes(`${I}select_00`, ["1", "2", "3", "4"]) },
  toggle: { description: "a switch flipping: turning something on or off", sources: takes(`${I}toggle_00`, ["1", "2", "3", "4"]) },
  open: { description: "a short opening swipe: a panel or lid opening", sources: takes(`${I}open_00`, ["1", "2", "3", "4"]) },
  close: { description: "a short closing swipe: a panel or lid closing", sources: takes(`${I}close_00`, ["1", "2", "3", "4"]) },
  rise: { description: "an upward sweep: growing, zooming in, levelling up", sources: takes(`${I}maximize_00`, ["1", "2", "3"]) },
  fall: { description: "a downward sweep: shrinking, zooming out, going away", sources: takes(`${I}minimize_00`, ["1", "2", "3"]) },
  drop: { description: "a soft plop: dropping an item into place, a droplet", sources: takes(`${I}drop_00`, ["1", "2", "3", "4"]) },
  pop: { description: "a tiny pop: a bubble, a seed, something appearing", sources: takes(`${I}pluck_00`, ["1", "2"]) },
  knock: { description: "a light knock on wood: a block landing, a tap on a table", sources: takes(`${M}impactWood_light_00`, ["0", "1", "2", "3"]) },
  thud: { description: "a soft, dull thud: something soft landing, a ball on grass", sources: takes(`${M}impactSoft_medium_00`, ["0", "1", "2", "3"]) },
  clink: { description: "a light glass clink: glassware touching, a test tube set down", sources: takes(`${M}impactGlass_light_00`, ["0", "1", "2", "3"]) },
  metal: { description: "a light metal hit: a tool, a lid, a pipe", sources: takes(`${M}impactMetal_light_00`, ["0", "1", "2", "3"]) },
  "step-grass": { description: "a footstep on grass", sources: takes(`${M}footstep_grass_00`, ["0", "1", "2"]) },
  "step-wood": { description: "a footstep on a wooden floor", sources: takes(`${M}footstep_wood_00`, ["0", "1", "2"]) },
  "step-stone": { description: "a footstep on concrete or stone", sources: takes(`${M}footstep_concrete_00`, ["0", "1", "2"]) },
  "step-snow": { description: "a footstep in snow", sources: takes(`${M}footstep_snow_00`, ["0", "1", "2"]) },
  page: { description: "a page turning: a book, a card flipping over", sources: [`${R}bookFlip2.ogg`, `${R}bookFlip3.ogg`] },
  coins: { description: "coins jingling: money, collecting a reward", sources: [`${R}handleCoins2.ogg`, `${R}handleCoins.ogg`] },
  creak: { description: "a wooden creak: a door, a branch, a floorboard", sources: [`${R}creak3.ogg`, `${R}creak1.ogg`] },
  chop: { description: "a chop: an axe, a knife on a board", sources: [`${R}chop.ogg`] },
  card: { description: "a card placed on a table", sources: takes(`${C}card-place-`, ["1", "2", "3"]) },
  dice: { description: "dice thrown onto a table", sources: takes(`${C}dice-throw-`, ["1", "2"]) },
  "power-up": { description: "an electronic rising arpeggio: a power-up, a level gained (game-like)", sources: [`${D}powerUp2.ogg`, `${D}powerUp1.ogg`] },
  zap: { description: "an electronic zap: electricity, a laser, a spark (game-like)", sources: [`${D}zap1.ogg`, `${D}zap2.ogg`] },
  fanfare: { description: "a short plucked-strings flourish: a win, a level complete", sources: [`${J}jingles_PIZZI00.ogg`, `${J}jingles_PIZZI04.ogg`] },
  "steel-drum": { description: "a short steel-drum flourish: a bright, cheerful success", sources: [`${J}jingles_STEEL00.ogg`] },
} as const satisfies Readonly<Record<string, SampleEntry>>;

export type SampleName = keyof typeof SAMPLES;

/** Sample names, in catalog order. */
export const SAMPLE_NAMES: readonly string[] = Object.keys(SAMPLES);

export function isSampleName(name: string): name is SampleName {
  return Object.hasOwn(SAMPLES, name);
}

/** The rate the library stores its samples at. */
export const LIBRARY_RATE = 22_050;
