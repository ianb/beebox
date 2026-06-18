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
 * Each kind can also carry an optional free-text **detail** string (e.g. the
 * embedding query the user typed, the path that was modified) that a view
 * supplies via `reportActivity(kind, detail)`. Details are surfaced as the
 * read-only `card-state` attribute. They are kept per-kind and latest-wins —
 * typing `b`,`bo`,`boa`,`boat` overwrites the same `explored` detail rather
 * than accumulating, so the snapshot shows only the final state.
 *
 * Canonical order (least → most consequential): `scrolled`, `navigated`,
 * `explored`, `modified`. Serialization, union, and detail-formatting all
 * project onto this order, so the attribute values are stable regardless of
 * arrival order.
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

/** Per-kind detail strings supplied via `reportActivity(kind, detail)`. */
export type CardStateDetails = Partial<Record<ActivityKind, string>>;

/**
 * Merge several detail maps into one, latest-wins per kind, dropping
 * unrecognized kinds and empty strings. Used to combine queued sends so a
 * later send's detail for a kind overrides an earlier one (matching the
 * latest-wins overwrite the live accumulator already does within a turn).
 */
export function mergeCardStateDetails(maps: Iterable<CardStateDetails | undefined>): CardStateDetails {
  const out: CardStateDetails = {};
  for (const map of maps) {
    if (map === undefined) continue;
    for (const [kind, detail] of Object.entries(map)) {
      if (isActivityKind(kind) && typeof detail === "string" && detail !== "") out[kind] = detail;
    }
  }
  return out;
}

/**
 * Render the per-kind details into the `card-state` attribute value:
 * `kind: detail` pairs in canonical order, joined by `; `. Returns
 * `undefined` when there are no details, so the caller omits the attribute.
 */
export function formatCardState(details: CardStateDetails): string | undefined {
  const parts = ACTIVITY_KINDS.filter((k) => {
    const d = details[k];
    return typeof d === "string" && d !== "";
  }).map((k) => `${k}: ${details[k] ?? ""}`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}
