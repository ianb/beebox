/**
 * Arrival: going to a place with no saved arrangement opens the place
 * (docs/plans/landmark-arrival.md, Track D). The workspace store holds the
 * candidate flag (`takeArrival`); the place's `landmarks.forDir` payload holds
 * the target (`arrival`: its single entry-point card, else the landmark card).
 * The phone layout opens nothing: one card or the chat fits, and the chat wins.
 */
export function arrivalOpens(input: {
  /** The store's candidate flag, already taken for this selection. */
  arrive: boolean;
  viewport: "mobile" | "desktop";
  /** Cards open in the workspace now; arrival never adds to an arrangement. */
  tabCount: number;
  /** The payload's `arrival` path; null when the place has no landmark or the query failed. */
  target: string | null;
}): boolean {
  return input.arrive && input.viewport === "desktop" && input.tabCount === 0 && input.target !== null;
}
