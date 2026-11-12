// Chemistry data for the balance-reaction sketch: elements, molecules (with a
// drawable atom layout), the reactions on offer, and the atom counting that
// decides whether an equation balances. Pure data and pure functions.

export const ELEMENTS = ["H", "C", "N", "O", "Fe"] as const;
export type Element = (typeof ELEMENTS)[number];

export interface ElementLook {
  name: string;
  /** Ball colour (the usual CPK-style element colours). */
  fill: string;
  /** Darker shade for the ball's lower edge and outline. */
  edge: string;
  /** Ball radius in molecule units. */
  radius: number;
}

export const LOOK: Record<Element, ElementLook> = {
  H: { name: "Hydrogen", fill: "#f7f7f4", edge: "#9a9a92", radius: 0.62 },
  C: { name: "Carbon", fill: "#4a4f5a", edge: "#22252b", radius: 0.9 },
  N: { name: "Nitrogen", fill: "#4f7fe0", edge: "#25459a", radius: 0.9 },
  O: { name: "Oxygen", fill: "#e5483c", edge: "#962018", radius: 0.9 },
  Fe: { name: "Iron", fill: "#d08a3e", edge: "#7d4a16", radius: 1.05 },
};

export interface Atom {
  el: Element;
  x: number;
  y: number;
}

export interface Molecule {
  /** Formula as (element, count) parts in written order, e.g. H₂O = [["H", 2], ["O", 1]]. */
  formula: readonly (readonly [Element, number])[];
  /** Atom layout in molecule units, drawn in this order (back to front). */
  atoms: readonly Atom[];
}

function a(el: Element, x: number, y: number): Atom {
  return { el, x, y };
}

export const MOLECULES = {
  H2: { formula: [["H", 2]], atoms: [a("H", -0.5, 0), a("H", 0.5, 0)] },
  O2: { formula: [["O", 2]], atoms: [a("O", -0.72, 0), a("O", 0.72, 0)] },
  N2: { formula: [["N", 2]], atoms: [a("N", -0.72, 0), a("N", 0.72, 0)] },
  H2O: { formula: [["H", 2], ["O", 1]], atoms: [a("H", -0.85, 0.62), a("H", 0.85, 0.62), a("O", 0, 0)] },
  CO2: { formula: [["C", 1], ["O", 2]], atoms: [a("C", 0, 0), a("O", -1.45, 0), a("O", 1.45, 0)] },
  CH4: {
    formula: [["C", 1], ["H", 4]],
    atoms: [a("H", 0, -1.05), a("H", -1.05, 0), a("C", 0, 0), a("H", 1.05, 0), a("H", 0, 1.05)],
  },
  NH3: { formula: [["N", 1], ["H", 3]], atoms: [a("H", 0, -1.05), a("N", 0, 0), a("H", -0.95, 0.6), a("H", 0.95, 0.6)] },
  Fe: { formula: [["Fe", 1]], atoms: [a("Fe", 0, 0)] },
  Fe2O3: {
    formula: [["Fe", 2], ["O", 3]],
    // O=Fe-O-Fe=O as a zigzag chain, iron drawn last so it stays visible
    atoms: [a("O", -2.5, 0.45), a("O", 0, 0.45), a("O", 2.5, 0.45), a("Fe", -1.25, -0.4), a("Fe", 1.25, -0.4)],
  },
  C3H8: {
    formula: [["C", 3], ["H", 8]],
    atoms: [
      a("H", -2.6, 0),
      a("H", -1.35, -1.2),
      a("H", -1.35, 1.2),
      a("H", 0, -1.2),
      a("H", 0, 1.2),
      a("H", 1.35, -1.2),
      a("H", 1.35, 1.2),
      a("H", 2.6, 0),
      a("C", -1.35, 0),
      a("C", 0, 0),
      a("C", 1.35, 0),
    ],
  },
} as const satisfies Record<string, Molecule>;

export type MoleculeId = keyof typeof MOLECULES;

export interface Reaction {
  title: string;
  left: readonly MoleculeId[];
  right: readonly MoleculeId[];
}

export const REACTION_IDS = ["water", "methane", "ammonia", "rust", "propane"] as const;
export type ReactionId = (typeof REACTION_IDS)[number];

export const REACTIONS: Record<ReactionId, Reaction> = {
  water: { title: "Hydrogen burns in oxygen to make water", left: ["H2", "O2"], right: ["H2O"] },
  methane: { title: "Methane (natural gas) burns", left: ["CH4", "O2"], right: ["CO2", "H2O"] },
  ammonia: { title: "Nitrogen and hydrogen make ammonia", left: ["N2", "H2"], right: ["NH3"] },
  rust: { title: "Iron rusts in oxygen", left: ["Fe", "O2"], right: ["Fe2O3"] },
  propane: { title: "Propane (barbecue gas) burns", left: ["C3H8", "O2"], right: ["CO2", "H2O"] },
};

/** The four typed boxes, in the order the species appear in the equation. */
export const SLOTS = ["A", "B", "C", "D"] as const;
export type Slot = (typeof SLOTS)[number];

export interface Tally {
  el: Element;
  left: number;
  right: number;
}

function countSide(side: readonly MoleculeId[], coefs: readonly number[], el: Element): number {
  let total = 0;
  for (const [i, id] of side.entries()) {
    const coef = coefs[i] ?? 1;
    for (const [e, n] of MOLECULES[id].formula) if (e === el) total += coef * n;
  }
  return total;
}

/** The elements that appear in a reaction, in the fixed ELEMENTS order. */
export function elementsOf(r: Reaction): Element[] {
  const present = new Set<Element>();
  for (const id of [...r.left, ...r.right]) for (const [e] of MOLECULES[id].formula) present.add(e);
  return ELEMENTS.filter((e) => present.has(e));
}

/** Atom counts per element on each side, given one coefficient per species (left then right). */
export function tally(r: Reaction, coefs: readonly number[]): Tally[] {
  const leftCoefs = coefs.slice(0, r.left.length);
  const rightCoefs = coefs.slice(r.left.length);
  return elementsOf(r).map((el) => ({ el, left: countSide(r.left, leftCoefs, el), right: countSide(r.right, rightCoefs, el) }));
}

function gcd(x: number, y: number): number {
  return y === 0 ? x : gcd(y, x % y);
}

/** The greatest common divisor of all coefficients (1 when the set is already in lowest terms). */
export function commonFactor(coefs: readonly number[]): number {
  return coefs.reduce((g, c) => gcd(g, c), 0);
}
