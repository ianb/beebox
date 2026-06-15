/**
 * Companion-pane card-activity vocabulary, shared by the backend snapshot
 * serializer (`chat-features.ts`), the queued-send combiner
 * (`chat-session-state.ts`), and the frontend accumulator
 * (`useCardActivity`).
 *
 * The four kinds describe, terse and referentially, what the user did to the
 * card open in the chat's two-pane companion layout since the agent's last
 * reply. They are surfaced to the agent as the read-only `card-activity`
 * snapshot attribute — a comma-joined string in the canonical order below —
 * and are deliberately framed as low-confidence hints, not assertions of
 * intent (`cb chat whats-changed` is the verifiable surface).
 *
 * Canonical order (least → most consequential): `scrolled`, `navigated`,
 * `explored`, `modified`. Serialization and union both project onto this
 * order, so the attribute value is stable regardless of arrival order.
 */

export const ACTIVITY_KINDS = ["scrolled", "navigated", "explored", "modified"] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const ACTIVITY_KIND_SET: ReadonlySet<string> = new Set(ACTIVITY_KINDS);

/** True if the string is one of the four recognized activity kinds. */
export function isActivityKind(s: string): s is ActivityKind {
  return ACTIVITY_KIND_SET.has(s);
}

/**
 * Project any collection of kind strings onto the canonical order,
 * de-duplicated, dropping anything unrecognized. Returns the joined string
 * for the snapshot attribute, or `undefined` when nothing survives — so the
 * caller passes `undefined` (not `""`) and the attribute is omitted (the
 * snapshot pipeline renders empty strings).
 */
export function joinActivityKinds(kinds: Iterable<string>): string | undefined {
  const present = new Set(kinds);
  const ordered = ACTIVITY_KINDS.filter((k) => present.has(k));
  return ordered.length > 0 ? ordered.join(",") : undefined;
}

/**
 * Union several activity lists into one canonical-ordered, de-duplicated
 * list, dropping unrecognized kinds. Used to combine queued sends so an
 * earlier queued message's activity is never lost (latest-wins would drop
 * it — see `combineQueuedInputs`).
 */
export function unionActivityKinds(lists: Iterable<Iterable<string> | undefined>): ActivityKind[] {
  const present = new Set<string>();
  for (const list of lists) {
    if (list === undefined) continue;
    for (const k of list) present.add(k);
  }
  return ACTIVITY_KINDS.filter((k) => present.has(k));
}
