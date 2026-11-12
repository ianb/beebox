// Main-group element data for the periodic trends explorer.
//
// Sources (values as commonly tabulated; rounded as shown):
//   - Atomic radius: single-bond covalent radius in picometres, B. Cordero et al.,
//     "Covalent radii revisited", Dalton Trans. 2008, 2832–2838 (carbon: sp3 value).
//     Covalent radii are used because they exist for the noble gases too.
//   - Electronegativity: Pauling scale, CRC Handbook of Chemistry and Physics
//     (as tabulated by WebElements). He, Ne, Ar and Rn have no Pauling value.
//   - First ionization energy: kJ/mol, converted from NIST Atomic Spectra Database
//     ionization energies (eV × 96.485), as tabulated in the CRC Handbook.

export type PropertyId = "atomic radius" | "electronegativity" | "ionization energy";
export const PROPERTY_IDS = ["atomic radius", "electronegativity", "ionization energy"] as const;

export interface Element {
  z: number;
  sym: string;
  name: string;
  period: number;
  group: number;
  radius: number;
  en: number | null;
  ie: number;
}

type Row = readonly [number, string, string, number, number, number, number | null, number];

const ROWS: readonly Row[] = [
  // z, symbol, name, period, group, covalent radius pm, Pauling EN, first IE kJ/mol
  [1, "H", "Hydrogen", 1, 1, 31, 2.2, 1312],
  [2, "He", "Helium", 1, 18, 28, null, 2372],
  [3, "Li", "Lithium", 2, 1, 128, 0.98, 520],
  [4, "Be", "Beryllium", 2, 2, 96, 1.57, 900],
  [5, "B", "Boron", 2, 13, 84, 2.04, 801],
  [6, "C", "Carbon", 2, 14, 76, 2.55, 1086],
  [7, "N", "Nitrogen", 2, 15, 71, 3.04, 1402],
  [8, "O", "Oxygen", 2, 16, 66, 3.44, 1314],
  [9, "F", "Fluorine", 2, 17, 57, 3.98, 1681],
  [10, "Ne", "Neon", 2, 18, 58, null, 2081],
  [11, "Na", "Sodium", 3, 1, 166, 0.93, 496],
  [12, "Mg", "Magnesium", 3, 2, 141, 1.31, 738],
  [13, "Al", "Aluminium", 3, 13, 121, 1.61, 578],
  [14, "Si", "Silicon", 3, 14, 111, 1.9, 787],
  [15, "P", "Phosphorus", 3, 15, 107, 2.19, 1012],
  [16, "S", "Sulfur", 3, 16, 105, 2.58, 1000],
  [17, "Cl", "Chlorine", 3, 17, 102, 3.16, 1251],
  [18, "Ar", "Argon", 3, 18, 106, null, 1521],
  [19, "K", "Potassium", 4, 1, 203, 0.82, 419],
  [20, "Ca", "Calcium", 4, 2, 176, 1.0, 590],
  [31, "Ga", "Gallium", 4, 13, 122, 1.81, 579],
  [32, "Ge", "Germanium", 4, 14, 120, 2.01, 762],
  [33, "As", "Arsenic", 4, 15, 119, 2.18, 947],
  [34, "Se", "Selenium", 4, 16, 120, 2.55, 941],
  [35, "Br", "Bromine", 4, 17, 120, 2.96, 1140],
  [36, "Kr", "Krypton", 4, 18, 116, 3.0, 1351],
  [37, "Rb", "Rubidium", 5, 1, 220, 0.82, 403],
  [38, "Sr", "Strontium", 5, 2, 195, 0.95, 549],
  [49, "In", "Indium", 5, 13, 142, 1.78, 558],
  [50, "Sn", "Tin", 5, 14, 139, 1.96, 709],
  [51, "Sb", "Antimony", 5, 15, 139, 2.05, 834],
  [52, "Te", "Tellurium", 5, 16, 138, 2.1, 869],
  [53, "I", "Iodine", 5, 17, 139, 2.66, 1008],
  [54, "Xe", "Xenon", 5, 18, 140, 2.6, 1170],
  [55, "Cs", "Caesium", 6, 1, 244, 0.79, 376],
  [56, "Ba", "Barium", 6, 2, 215, 0.89, 503],
  [81, "Tl", "Thallium", 6, 13, 145, 1.62, 589],
  [82, "Pb", "Lead", 6, 14, 146, 2.33, 716],
  [83, "Bi", "Bismuth", 6, 15, 148, 2.02, 703],
  [84, "Po", "Polonium", 6, 16, 140, 2.0, 812],
  [85, "At", "Astatine", 6, 17, 150, 2.2, 899],
  [86, "Rn", "Radon", 6, 18, 150, null, 1037],
];

export const ELEMENTS: readonly Element[] = ROWS.map(([z, sym, name, period, group, radius, en, ie]) => ({
  z,
  sym,
  name,
  period,
  group,
  radius,
  en,
  ie,
}));

export const GROUPS = [1, 2, 13, 14, 15, 16, 17, 18] as const;
export const PERIODS = [1, 2, 3, 4, 5, 6] as const;

export interface PropertyInfo {
  /** Axis and panel label. */
  label: string;
  unit: string;
  /** Fixed axis range, shared by every period and group so lines compare. */
  min: number;
  max: number;
  tick: number;
  /** Decimal places when printing a value. */
  digits: number;
  /** +1 if the value is expected to rise across a period (left to right), -1 if it falls. */
  across: 1 | -1;
  /** +1 if the value is expected to rise down a group, -1 if it falls. */
  down: 1 | -1;
  trend: string;
  why: string;
  source: string;
}

export const PROPERTIES: Readonly<Record<PropertyId, PropertyInfo>> = {
  "atomic radius": {
    label: "Atomic radius",
    unit: "pm",
    min: 0,
    max: 250,
    tick: 50,
    digits: 0,
    across: -1,
    down: 1,
    trend: "Grows down a group, shrinks across a period.",
    why: "Each new period adds a shell of electrons. Across a period the shell stays the same but the nucleus gains protons and pulls it in.",
    source: "Covalent radius (pm), Cordero et al. 2008",
  },
  electronegativity: {
    label: "Electronegativity",
    unit: "",
    min: 0,
    max: 4,
    tick: 1,
    digits: 2,
    across: 1,
    down: -1,
    trend: "Rises across a period, falls down a group.",
    why: "A small atom with a strong pull from its nucleus attracts shared electrons strongly. Most noble gases form no bonds, so they have no value.",
    source: "Pauling scale, CRC Handbook",
  },
  "ionization energy": {
    label: "First ionization energy",
    unit: "kJ/mol",
    min: 0,
    max: 2500,
    tick: 500,
    digits: 0,
    across: 1,
    down: -1,
    trend: "Rises across a period, falls down a group.",
    why: "The energy to pull off the outermost electron. Electrons further out, or shielded by more inner shells, come off more easily.",
    source: "First ionization energy (kJ/mol), NIST / CRC Handbook",
  },
};

export function valueOf(e: Element, prop: PropertyId): number | null {
  switch (prop) {
    case "atomic radius":
      return e.radius;
    case "electronegativity":
      return e.en;
    case "ionization energy":
      return e.ie;
  }
}

export function formatValue(v: number | null, prop: PropertyId): string {
  if (v === null) return "no value";
  const info = PROPERTIES[prop];
  const num = v.toFixed(info.digits);
  return info.unit === "" ? num : `${num} ${info.unit}`;
}

export type Line = { kind: "period"; n: number } | { kind: "group"; n: number };

export function lineMembers(line: Line): Element[] {
  return line.kind === "period"
    ? ELEMENTS.filter((e) => e.period === line.n)
    : ELEMENTS.filter((e) => e.group === line.n);
}

export function lineTitle(line: Line): string {
  return line.kind === "period" ? `Across period ${line.n}` : `Down group ${line.n}`;
}

/** Elements in a line whose step from the previous element goes against the trend. */
export function exceptions(line: Line, prop: PropertyId): Element[] {
  const info = PROPERTIES[prop];
  const dir = line.kind === "period" ? info.across : info.down;
  const members = lineMembers(line);
  const out: Element[] = [];
  for (const [i, e] of members.entries()) {
    const prev = members[i - 1];
    const a = prev === undefined ? null : valueOf(prev, prop);
    const b = valueOf(e, prop);
    if (a !== null && b !== null && (b - a) * dir < 0) out.push(e);
  }
  return out;
}

export function bySymbol(sym: string): Element | undefined {
  return ELEMENTS.find((e) => e.sym === sym);
}
