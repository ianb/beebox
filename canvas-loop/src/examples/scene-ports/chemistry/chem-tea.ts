// Chemistry data for the balancing sketch: elements, molecules (atom layouts),
// reactions, and the atom tally. Pure data and pure functions only.

export type El = "H" | "C" | "N" | "O" | "Fe";

export interface ElementInfo {
  name: string;
  fill: string;
  edge: string;
  text: string;
  /** Atom radius in molecule units. */
  r: number;
}

export const ELEMENTS: Readonly<Record<El, ElementInfo>> = {
  H: { name: "hydrogen", fill: "#f8fafc", edge: "#94a3b8", text: "#334155", r: 0.55 },
  C: { name: "carbon", fill: "#3f4654", edge: "#1f2937", text: "#f8fafc", r: 0.8 },
  N: { name: "nitrogen", fill: "#3b82f6", edge: "#1e40af", text: "#f8fafc", r: 0.78 },
  O: { name: "oxygen", fill: "#ef4444", edge: "#991b1b", text: "#ffffff", r: 0.75 },
  Fe: { name: "iron", fill: "#d97706", edge: "#7c2d12", text: "#ffffff", r: 0.95 },
};

export interface Atom {
  el: El;
  x: number;
  y: number;
}

export interface Molecule {
  formula: string;
  /** Atoms in paint order (back to front). */
  atoms: readonly Atom[];
}

const a = (el: El, x: number, y: number): Atom => ({ el, x, y });

export const MOLECULES = {
  H2: { formula: "H2", atoms: [a("H", -0.42, 0), a("H", 0.42, 0)] },
  O2: { formula: "O2", atoms: [a("O", -0.6, 0), a("O", 0.6, 0)] },
  N2: { formula: "N2", atoms: [a("N", -0.62, 0), a("N", 0.62, 0)] },
  H2O: { formula: "H2O", atoms: [a("H", -0.8, 0.5), a("H", 0.8, 0.5), a("O", 0, -0.05)] },
  CH4: {
    formula: "CH4",
    atoms: [a("H", -0.78, -0.62), a("H", 0.78, -0.62), a("H", -0.78, 0.62), a("H", 0.78, 0.62), a("C", 0, 0)],
  },
  CO2: { formula: "CO2", atoms: [a("O", -1.25, 0), a("O", 1.25, 0), a("C", 0, 0)] },
  NH3: { formula: "NH3", atoms: [a("H", -1.0, 0.5), a("H", 1.0, 0.5), a("H", 0, -1.02), a("N", 0, 0.08)] },
  Fe: { formula: "Fe", atoms: [a("Fe", 0, 0)] },
  Fe2O3: {
    formula: "Fe2O3",
    atoms: [a("O", -1.75, 0.55), a("O", 0, 0.55), a("O", 1.75, 0.55), a("Fe", -0.88, -0.35), a("Fe", 0.88, -0.35)],
  },
  C3H8: {
    formula: "C3H8",
    atoms: [
      a("H", -2.2, 0),
      a("H", -1.3, -0.92),
      a("H", -1.3, 0.92),
      a("H", 0, -0.92),
      a("H", 0, 0.92),
      a("H", 1.3, -0.92),
      a("H", 1.3, 0.92),
      a("H", 2.2, 0),
      a("C", -1.3, 0),
      a("C", 0, 0),
      a("C", 1.3, 0),
    ],
  },
} as const satisfies Record<string, Molecule>;

export type MoleculeId = keyof typeof MOLECULES;

export interface Reaction {
  /** The select option text. */
  label: string;
  /** What happens, in words a learner knows. */
  story: string;
  left: readonly MoleculeId[];
  right: readonly MoleculeId[];
}

export const REACTION_LABELS = [
  "Water: H₂ + O₂ → H₂O",
  "Burning methane: CH₄ + O₂ → CO₂ + H₂O",
  "Ammonia: N₂ + H₂ → NH₃",
  "Rust: Fe + O₂ → Fe₂O₃",
  "Burning propane: C₃H₈ + O₂ → CO₂ + H₂O",
] as const;

export type ReactionLabel = (typeof REACTION_LABELS)[number];

export const REACTIONS: Readonly<Record<ReactionLabel, Reaction>> = {
  "Water: H₂ + O₂ → H₂O": {
    label: "Water",
    story: "Hydrogen gas burns with oxygen to make water.",
    left: ["H2", "O2"],
    right: ["H2O"],
  },
  "Burning methane: CH₄ + O₂ → CO₂ + H₂O": {
    label: "Burning methane",
    story: "Natural gas (methane) burns in oxygen, giving carbon dioxide and water.",
    left: ["CH4", "O2"],
    right: ["CO2", "H2O"],
  },
  "Ammonia: N₂ + H₂ → NH₃": {
    label: "Ammonia",
    story: "Nitrogen and hydrogen join to make ammonia, used in fertiliser.",
    left: ["N2", "H2"],
    right: ["NH3"],
  },
  "Rust: Fe + O₂ → Fe₂O₃": {
    label: "Rust",
    story: "Iron slowly reacts with oxygen in the air to make rust.",
    left: ["Fe", "O2"],
    right: ["Fe2O3"],
  },
  "Burning propane: C₃H₈ + O₂ → CO₂ + H₂O": {
    label: "Burning propane",
    story: "Propane in a camping stove burns in oxygen, giving carbon dioxide and water.",
    left: ["C3H8", "O2"],
    right: ["CO2", "H2O"],
  },
};

export interface Slot {
  /** Index into the coefficient list (0..3). */
  index: number;
  molecule: Molecule;
  coefficient: number;
}

export interface Tally {
  el: El;
  left: number;
  right: number;
}

export interface Analysis {
  reaction: Reaction;
  left: readonly Slot[];
  right: readonly Slot[];
  /** Elements in the order they first appear in the equation. */
  tallies: readonly Tally[];
  balanced: boolean;
  /** Greatest common divisor of the used coefficients (> 1: not the simplest form). */
  divisor: number;
}

function gcd(x: number, y: number): number {
  return y === 0 ? x : gcd(y, x % y);
}

function countIn(slots: readonly Slot[], el: El): number {
  let total = 0;
  for (const slot of slots) {
    for (const atom of slot.molecule.atoms) if (atom.el === el) total += slot.coefficient;
  }
  return total;
}

export function analyse(label: ReactionLabel, coefficients: readonly number[]): Analysis {
  const reaction = REACTIONS[label];
  const slot = (id: MoleculeId, index: number): Slot => ({
    index,
    molecule: MOLECULES[id],
    coefficient: coefficients[index] ?? 1,
  });
  const left = reaction.left.map((id, i) => slot(id, i));
  const right = reaction.right.map((id, i) => slot(id, reaction.left.length + i));
  const order: El[] = [];
  for (const s of [...left, ...right]) {
    for (const atom of s.molecule.atoms) if (!order.includes(atom.el)) order.push(atom.el);
  }
  const tallies = order.map((el) => ({ el, left: countIn(left, el), right: countIn(right, el) }));
  const balanced = tallies.every((t) => t.left === t.right);
  const divisor = [...left, ...right].reduce((g, s) => gcd(g, s.coefficient), 0);
  return { reaction, left, right, tallies, balanced, divisor };
}

/** Split "C3H8" into element symbols and their subscripts. */
export function formulaParts(formula: string): readonly { symbol: string; sub: string }[] {
  const parts: { symbol: string; sub: string }[] = [];
  for (const match of formula.matchAll(/([A-Z][a-z]?)(\d*)/gu)) {
    parts.push({ symbol: match[1] ?? "", sub: match[2] ?? "" });
  }
  return parts;
}
