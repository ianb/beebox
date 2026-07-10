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
 * supplies via `reportActivity(kind, detail)`. Both ride the snapshot as
 * `<card-activity kind="…">detail</card-activity>` child elements of
 * `<chat-app>` (children, not attributes, so a detail can be long/multi-line).
 * Details are kept per-kind and latest-wins — typing `b`,`bo`,`boa`,`boat`
 * overwrites the same `explored` detail rather than accumulating, so the
 * snapshot shows only the final state.
 *
 * Canonical order (least → most consequential): `scrolled`, `navigated`,
 * `explored`, `modified`. Rendering and union both project onto this order, so
 * the output is stable regardless of arrival order.
 */

export const ACTIVITY_KINDS = ["scrolled", "navigated", "explored", "modified"] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const ACTIVITY_KIND_SET: ReadonlySet<string> = new Set(ACTIVITY_KINDS);

/** True if the string is one of the four recognized activity kinds. */
export function isActivityKind(s: string): s is ActivityKind {
  return ACTIVITY_KIND_SET.has(s);
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

function escapeXmlText(s: string): string {
  // `<` and `&` must be escaped in element text; `>` need not be, and leaving
  // it raw keeps details like "boat -> boats" legible to the agent.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/**
 * Render the per-turn activity as `<card-activity>` child elements of
 * `<chat-app>` — one per kind in canonical order, with the optional detail as
 * element text (kinds without a detail are self-closing). Returns `""` when
 * nothing survives, so the caller keeps `<chat-app>` self-closing.
 *
 * Children rather than attributes (which is what this replaced): a detail is
 * free-form and can be long or multi-line, which an XML attribute can't carry
 * cleanly, and the set of kinds grows without an ever-widening attribute.
 *
 * Two kinds are suppressed when they'd tell the agent nothing it can't already
 * see, so they don't waste a line of context as bare noise:
 *  - `scrolled` with no detail — "they scrolled" without *where* is contentless
 *    (the frontend attaches no scroll position today, so this is every scroll).
 *  - `navigated` whose target equals `openCard` — its detail is latest-wins,
 *    i.e. the card currently open, so it merely restates the `open-card`
 *    attribute the snapshot already carries.
 */
export function renderActivityChildren(
  { kinds, details, openCard }: { kinds: Iterable<string>; details: CardStateDetails; openCard?: string },
): string {
  const present = new Set(kinds);
  const lines: string[] = [];
  for (const kind of ACTIVITY_KINDS) {
    if (!present.has(kind)) continue;
    const detail = details[kind];
    const hasDetail = typeof detail === "string" && detail !== "";
    if (kind === "scrolled" && !hasDetail) continue;
    if (kind === "navigated" && (!hasDetail || detail === openCard)) continue;
    lines.push(
      hasDetail && typeof detail === "string"
        ? `<card-activity kind="${kind}">${escapeXmlText(detail)}</card-activity>`
        : `<card-activity kind="${kind}"/>`,
    );
  }
  return lines.join("\n");
}
