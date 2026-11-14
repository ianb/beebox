// Body types: an archetype (man, woman, child) sets proportions, and three
// modifiers in -1..1 (height, weight, chest) move within ranges that stay
// believable for that archetype. Everything else (limb lengths, girths, head
// size, how fast the legs cycle) follows from those.
//
// Proportions: adult segment lengths as fractions of height (Drillis & Contini,
// via Winter); a child of about eight has a head near 1/6 of their height and
// legs about 47% of it.

export type Archetype = "man" | "woman" | "child";

export interface BodySpec {
  kind: Archetype;
  /** -1 shortest .. 1 tallest for the archetype. */
  height?: number;
  /** -1 slight .. 1 heavy. */
  weight?: number;
  /** -1 flat .. 1 full. */
  chest?: number;
}

/** Metres, all from the side unless named a width (seen from the front). */
export interface Build {
  id: string;
  height: number;
  thigh: number;
  shank: number;
  ankleHigh: number;
  heelBack: number;
  ball: number;
  toe: number;
  torso: number;
  upperArm: number;
  forearm: number;
  hand: number;
  neck: number;
  /** Head height (crown to chin). */
  head: number;
  /** Limb thickness scale (1 = the 1.65 m reference). */
  limb: number;
  /** Trunk depth scale and the extra depth at the chest, belly and seat. */
  depth: number;
  chest: number;
  belly: number;
  seat: number;
  /** Half-widths seen from the front. */
  shoulders: number;
  waist: number;
  hips: number;
  /** Leg-cycle rate relative to the captured actors: shorter legs step faster. */
  pace: number;
}

interface Proportions {
  heights: readonly [number, number, number];
  hip: number;
  torso: number;
  head: number;
  upperArm: number;
  forearm: number;
  foot: number;
  neck: number;
  shoulders: number;
  waist: number;
  hips: number;
  seat: number;
  chest: readonly [number, number];
  belly: number;
}

const ARCHETYPES: Record<Archetype, Proportions> = {
  man: { heights: [1.62, 1.76, 1.92], hip: 0.53, torso: 0.288, head: 0.13, upperArm: 0.188, forearm: 0.146, foot: 0.152, neck: 0.03, shoulders: 0.205, waist: 0.15, hips: 0.165, seat: 0.008, chest: [0.0, 0.025], belly: 0 },
  woman: { heights: [1.5, 1.63, 1.78], hip: 0.53, torso: 0.285, head: 0.13, upperArm: 0.183, forearm: 0.143, foot: 0.148, neck: 0.033, shoulders: 0.18, waist: 0.125, hips: 0.185, seat: 0.028, chest: [0.006, 0.075], belly: 0 },
  child: { heights: [1.05, 1.25, 1.45], hip: 0.47, torso: 0.3, head: 0.17, upperArm: 0.17, forearm: 0.135, foot: 0.15, neck: 0.025, shoulders: 0.145, waist: 0.12, hips: 0.125, seat: 0.01, chest: [0, 0.004], belly: 0.012 },
};

const clamp = (x: number | undefined): number => Math.max(-1, Math.min(1, x ?? 0));
const pick = (r: readonly [number, number, number], t: number): number => (t < 0 ? r[1] + (r[1] - r[0]) * t : r[1] + (r[2] - r[1]) * t);

/** The reference body the captured walks were scaled to. */
const REF_HIP = 0.53 * 1.65;

export function buildOf(spec: BodySpec): Build {
  const a = ARCHETYPES[spec.kind];
  const ht = clamp(spec.height), wt = clamp(spec.weight), ch = clamp(spec.chest);
  const H = pick(a.heights, ht);
  const size = H / 1.65;
  const hipH = a.hip * H;
  // Weight thickens everything, most of all the belly and seat.
  const girth = wt < 0 ? 1 + 0.16 * wt : 1 + 0.38 * wt;
  const heavy = Math.max(0, wt);
  return {
    id: `${spec.kind}:${ht.toFixed(2)}:${wt.toFixed(2)}:${ch.toFixed(2)}`,
    height: H,
    thigh: hipH * 0.463,
    shank: hipH * 0.464,
    ankleHigh: hipH * 0.073,
    heelBack: a.foot * H * 0.28,
    ball: a.foot * H * 0.6,
    toe: a.foot * H * 0.8,
    torso: a.torso * H,
    upperArm: a.upperArm * H,
    forearm: a.forearm * H,
    hand: 0.05 * H,
    neck: a.neck * H,
    head: a.head * H,
    limb: (spec.kind === "child" ? 0.8 : 1) * Math.max(0.75, size) * girth,
    depth: Math.max(0.72, size) * (0.92 + 0.08 * girth) * (wt < 0 ? 1 + 0.1 * wt : 1),
    chest: (a.chest[0] + (a.chest[1] - a.chest[0]) * (ch + 1) / 2) * size + heavy * 0.012,
    belly: (a.belly + heavy * 0.11 + (spec.kind === "man" ? heavy * 0.03 : 0)) * size,
    seat: (a.seat + heavy * 0.03) * size,
    shoulders: a.shoulders * size * (0.93 + 0.12 * girth),
    waist: (a.waist * girth + heavy * 0.06) * size,
    hips: a.hips * size * girth,
    pace: Math.sqrt(REF_HIP / hipH),
  };
}

/** The 1.65 m body every earlier sheet was drawn with. */
export const REFERENCE: Build = { ...buildOf({ kind: "woman", height: 0.13 }), id: "reference", pace: 1 };
