/**
 * Destination roles on landmark cards.
 *
 * A landmark advertises that its directory is a *destination* — a named spot
 * the system files things into — with a `<destination for="…">` role, where
 * `for` is a space-separated set of kinds:
 *
 *   <destination for="triage">…</destination>            triage-routing target
 *   <destination for="commentary"/>                       commentary filing spot
 *   <destination for="triage commentary">…</destination>  both
 *
 * The legacy `<triage-destination>` element is treated as
 * `<destination for="triage">` for back-compat during the migration window
 * (see docs/plans/web-page-commentary.md, Track 1).
 *
 * Pure element inspection — no Node deps — so it's safe to import from both
 * core (triage) and the webapp (clerk routes).
 */

import type { ElementNode } from "cardworks";

/** Destination kinds the system understands. `for` may list any subset. */
export const DESTINATION_KINDS = ["triage", "commentary"] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

/**
 * The destination kinds a single landmark child role advertises. Returns the
 * `for` tokens for a `<destination>`, `["triage"]` for the legacy
 * `<triage-destination>`, and `[]` for any other element (e.g. navigation).
 */
export function roleDestinationKinds(role: ElementNode): string[] {
  if (role.tagName === "triage-destination") return ["triage"];
  if (role.tagName !== "destination") return [];
  const forAttr = role.attrs["for"];
  if (typeof forAttr !== "string") return [];
  return forAttr.trim().split(/\s+/).filter((token) => token !== "");
}

/**
 * Find the destination role on a landmark element advertising `kind`, or
 * `null`. Matches both `<destination for="…kind…">` and (for `triage`) the
 * legacy `<triage-destination>`.
 */
export function findDestination(landmark: ElementNode, kind: DestinationKind): ElementNode | null {
  for (const child of landmark.children) {
    if (roleDestinationKinds(child).includes(kind)) return child;
  }
  return null;
}
