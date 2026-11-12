// Main-group element data for the periodic trends explorer.
//
// Sources (values as tabulated there):
//   - radius: single-bond covalent radius in pm, B. Cordero et al.,
//     "Covalent radii revisited", Dalton Trans. 2008, 2832-2838
//     (the set that also gives the noble gases a value; C is the sp3 value).
//   - en: Pauling electronegativity, CRC Handbook of Chemistry and Physics
//     (as listed on Wikipedia's "Electronegativities of the elements" data page).
//     He, Ne and Ar have no value: they form no stable compounds.
//   - ie: first ionization energy in kJ/mol, CRC Handbook / NIST Atomic
//     Spectra Database, rounded to 0.1 kJ/mol.

export type PropKey = "radius" | "en" | "ie";

export interface ElementData {
  z: number;
  symbol: string;
  name: string;
  group: number;
  period: number;
  radius: number;
  en: number | null;
  ie: number;
}

function el(
  z: number,
  symbol: string,
  name: string,
  place: readonly [group: number, period: number],
  values: readonly [radius: number, en: number | null, ie: number],
): ElementData {
  return { z, symbol, name, group: place[0], period: place[1], radius: values[0], en: values[1], ie: values[2] };
}

export const ELEMENTS: readonly ElementData[] = [
  el(1, "H", "Hydrogen", [1, 1], [31, 2.2, 1312.0]),
  el(2, "He", "Helium", [18, 1], [28, null, 2372.3]),
  el(3, "Li", "Lithium", [1, 2], [128, 0.98, 520.2]),
  el(4, "Be", "Beryllium", [2, 2], [96, 1.57, 899.5]),
  el(5, "B", "Boron", [13, 2], [84, 2.04, 800.6]),
  el(6, "C", "Carbon", [14, 2], [76, 2.55, 1086.5]),
  el(7, "N", "Nitrogen", [15, 2], [71, 3.04, 1402.3]),
  el(8, "O", "Oxygen", [16, 2], [66, 3.44, 1313.9]),
  el(9, "F", "Fluorine", [17, 2], [57, 3.98, 1681.0]),
  el(10, "Ne", "Neon", [18, 2], [58, null, 2080.7]),
  el(11, "Na", "Sodium", [1, 3], [166, 0.93, 495.8]),
  el(12, "Mg", "Magnesium", [2, 3], [141, 1.31, 737.7]),
  el(13, "Al", "Aluminium", [13, 3], [121, 1.61, 577.5]),
  el(14, "Si", "Silicon", [14, 3], [111, 1.9, 786.5]),
  el(15, "P", "Phosphorus", [15, 3], [107, 2.19, 1011.8]),
  el(16, "S", "Sulfur", [16, 3], [105, 2.58, 999.6]),
  el(17, "Cl", "Chlorine", [17, 3], [102, 3.16, 1251.2]),
  el(18, "Ar", "Argon", [18, 3], [106, null, 1520.6]),
  el(19, "K", "Potassium", [1, 4], [203, 0.82, 418.8]),
  el(20, "Ca", "Calcium", [2, 4], [176, 1.0, 589.8]),
  el(31, "Ga", "Gallium", [13, 4], [122, 1.81, 578.8]),
  el(32, "Ge", "Germanium", [14, 4], [120, 2.01, 762.0]),
  el(33, "As", "Arsenic", [15, 4], [119, 2.18, 947.0]),
  el(34, "Se", "Selenium", [16, 4], [120, 2.55, 941.0]),
  el(35, "Br", "Bromine", [17, 4], [120, 2.96, 1139.9]),
  el(36, "Kr", "Krypton", [18, 4], [116, 3.0, 1350.8]),
  el(37, "Rb", "Rubidium", [1, 5], [220, 0.82, 403.0]),
  el(38, "Sr", "Strontium", [2, 5], [195, 0.95, 549.5]),
  el(49, "In", "Indium", [13, 5], [142, 1.78, 558.3]),
  el(50, "Sn", "Tin", [14, 5], [139, 1.96, 708.6]),
  el(51, "Sb", "Antimony", [15, 5], [139, 2.05, 834.0]),
  el(52, "Te", "Tellurium", [16, 5], [138, 2.1, 869.3]),
  el(53, "I", "Iodine", [17, 5], [139, 2.66, 1008.4]),
  el(54, "Xe", "Xenon", [18, 5], [140, 2.6, 1170.4]),
  el(55, "Cs", "Caesium", [1, 6], [244, 0.79, 375.7]),
  el(56, "Ba", "Barium", [2, 6], [215, 0.89, 502.9]),
  el(81, "Tl", "Thallium", [13, 6], [145, 1.62, 589.4]),
  el(82, "Pb", "Lead", [14, 6], [146, 1.87, 715.6]),
  el(83, "Bi", "Bismuth", [15, 6], [148, 2.02, 703.0]),
  el(84, "Po", "Polonium", [16, 6], [140, 2.0, 812.1]),
  el(85, "At", "Astatine", [17, 6], [150, 2.2, 899.0]),
  el(86, "Rn", "Radon", [18, 6], [150, 2.2, 1037.0]),
];

/** The element at an index into ELEMENTS; an out-of-range index is a bug. */
export function element(i: number): ElementData {
  const e = ELEMENTS[i];
  if (e === undefined) throw new RangeError(`no element at index ${i}`);
  return e;
}

export const GROUPS: readonly number[] = [1, 2, 13, 14, 15, 16, 17, 18];
export const PERIODS: readonly number[] = [1, 2, 3, 4, 5, 6];

export interface PropInfo {
  key: PropKey;
  /** Axis and panel name. */
  label: string;
  unit: string;
  /** Fixed axis range, so every period and group is drawn on the same scale. */
  min: number;
  max: number;
  tick: number;
  decimals: number;
  /** +1: the value rises across a period (left to right); -1: it falls. */
  across: 1 | -1;
  /** +1: the value rises down a group; -1: it falls. */
  down: 1 | -1;
}

export const PROPS: Readonly<Record<PropKey, PropInfo>> = {
  radius: { key: "radius", label: "Atomic radius", unit: "pm", min: 0, max: 250, tick: 50, decimals: 0, across: -1, down: 1 },
  en: { key: "en", label: "Electronegativity", unit: "", min: 0.5, max: 4, tick: 0.5, decimals: 2, across: 1, down: -1 },
  ie: { key: "ie", label: "First ionization energy", unit: "kJ/mol", min: 0, max: 2500, tick: 500, decimals: 0, across: 1, down: -1 },
};

const NOBLE_RADIUS = "Noble-gas covalent radii come from a few rare compounds, so they sit off the trend.";
const P_DROP = "Lower than the element before it: the new electron starts a p subshell, which is higher in energy and easier to remove.";
const PAIR_DROP = "Lower than the element before it: this electron is the first to share a p orbital, and the pair repel each other.";
const D_PULL = "Higher than you might expect: the ten d-block protons added before this element are poorly shielded, so they pull harder.";

/** Short notes on values that break the simple trend, by property and symbol. */
export const NOTES: Readonly<Record<PropKey, Readonly<Record<string, string>>>> = {
  radius: {
    Ga: "Barely bigger than Al: the ten d-block protons added before gallium pull its electrons in.",
    Ne: NOBLE_RADIUS,
    Ar: NOBLE_RADIUS,
    Kr: NOBLE_RADIUS,
    Xe: NOBLE_RADIUS,
    Rn: NOBLE_RADIUS,
    He: NOBLE_RADIUS,
  },
  en: {
    He: "No Pauling value: helium forms no compounds.",
    Ne: "No Pauling value: neon forms no compounds.",
    Ar: "No Pauling value: argon forms no stable compounds.",
    Ga: D_PULL,
    Kr: "Krypton and xenon form a few compounds with fluorine, so they have values.",
    Xe: "Krypton and xenon form a few compounds with fluorine, so they have values.",
  },
  ie: {
    B: P_DROP,
    Al: P_DROP,
    O: PAIR_DROP,
    S: PAIR_DROP,
    Ga: D_PULL,
    Tl: D_PULL,
    Bi: "Lower than lead, against the trend: in atoms this heavy the electrons move fast enough for relativity to change the 6p orbitals.",
  },
};

export function valueOf(e: ElementData, key: PropKey): number | null {
  switch (key) {
    case "radius":
      return e.radius;
    case "en":
      return e.en;
    case "ie":
      return e.ie;
  }
}

export function formatValue(value: number | null, info: PropInfo): string {
  if (value === null) return "—";
  return value.toFixed(info.decimals);
}
