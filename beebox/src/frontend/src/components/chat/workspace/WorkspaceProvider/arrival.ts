import type { WorkspaceNavigationDecision } from "../history";

/**
 * Arrival: going to a place with no saved arrangement opens the place
 * (docs/implemented-plans/landmark-arrival.md, Track D). The workspace store holds the
 * candidate flag (`takeArrival`); the place's `landmarks.forDir` payload holds
 * the target (`arrival`: its single entry-point card, else the landmark card).
 *
 * At the root, arrival also opens the newest pending question, active, so a
 * new chat has the question beside it
 * (docs/plans/questions-beside-the-chat.md, Track A). The desktop opens the
 * place first and the question on top; the phone, where one card or the chat
 * fits, opens only the question, and otherwise nothing: the chat wins.
 * Returns the paths to open in order; the last is the active tab.
 */
export function arrivalPlan(input: {
  /** The store's candidate flag, already taken for this selection. */
  arrive: boolean;
  viewport: "mobile" | "desktop";
  /** Cards open in the workspace now; arrival never adds to an arrangement. */
  tabCount: number;
  /** The payload's `arrival` path; null when the place has no landmark or the query failed. */
  target: string | null;
  /** The root's arrival question (`pickArrivalQuestion`, `questions/question-tab.ts`); null elsewhere, when none is pending, or when the query failed. */
  question: string | null;
}): string[] {
  if (!input.arrive || input.tabCount > 0) return [];
  const question = input.question === null ? [] : [input.question];
  if (input.viewport === "mobile") return question;
  return [...(input.target === null ? [] : [input.target]), ...question];
}

/**
 * Whether the provider holds a navigation step until arrival's queries
 * settle. Only `keep-current` can arrive, so only it waits: a card URL
 * (`open-url`) or a history snapshot (`restore-snapshot`) proceeds at once,
 * however slow the queries are. `settled` is true when every query arrival
 * enabled has succeeded or failed, and when it enabled none (the phone
 * outside the root never arrives, so it never waits).
 */
export function arrivalWaits(input: {
  decision: WorkspaceNavigationDecision["kind"];
  /** The store's candidate flag, not yet taken. */
  candidate: boolean;
  settled: boolean;
}): boolean {
  return input.decision === "keep-current" && input.candidate && !input.settled;
}
