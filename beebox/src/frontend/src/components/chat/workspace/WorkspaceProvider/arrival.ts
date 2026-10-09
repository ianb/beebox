import type { WorkspaceNavigationDecision } from "../history";

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

/**
 * Whether the provider holds a navigation step until the place's query
 * settles. Only `keep-current` can arrive, so only it waits: a card URL
 * (`open-url`) or a history snapshot (`restore-snapshot`) proceeds at once,
 * however slow the query is. The phone layout never arrives, so it never waits.
 */
export function arrivalWaits(input: {
  decision: WorkspaceNavigationDecision["kind"];
  /** The store's candidate flag, not yet taken. */
  candidate: boolean;
  viewport: "mobile" | "desktop";
  /** The `landmarks.forDir` query succeeded or failed. */
  settled: boolean;
}): boolean {
  return input.decision === "keep-current" && input.candidate && input.viewport === "desktop" && !input.settled;
}
