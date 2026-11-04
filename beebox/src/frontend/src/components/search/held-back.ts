/** One configured search area that default search held back, and how many matches it held. */
export interface HeldBack {
  area: string;
  count: number;
}

/** The line shown under results when areas were held back, or null when none were. */
export function heldBackText(heldBack: HeldBack[]): string | null {
  if (heldBack.length === 0) return null;
  const parts = heldBack.map(({ area, count }) => `${String(count)} more in ${area}`);
  return `${parts.join(", ")} (held back from this search)`;
}

/** The path badge of the Search card: "all paths" is false while something is held back. */
export function pathsBadgeText({ paths, heldBack }: { paths: string[]; heldBack: HeldBack[] }): string {
  if (paths.length > 0) return `paths: ${paths.join(", ")}`;
  if (heldBack.length === 0) return "all paths";
  return `all paths except ${heldBack.map(({ area }) => area).join(", ")}`;
}
