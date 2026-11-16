/**
 * What a page does when the server serves a different frontend build than the
 * one it runs (`shared/frontend-build.ts`). Pure, so every rule is in one
 * table test.
 *
 * - `none`: no skew, or either identity is unknown (the dev server's page has
 *   none). Unknown never reloads.
 * - `wait`: skew while the tab is hidden; decide again when it is shown.
 * - `reload`: the tab was just shown, the person has not touched it yet,
 *   nothing would be lost, and no earlier reload in this tab already went
 *   for this same server build.
 * - `banner`: skew, and any of those does not hold.
 */

export type BuildAction = "none" | "wait" | "reload" | "banner";

export interface BuildDecisionInput {
  /** This page's own build identity; null on a page without one. */
  client: string | null;
  /** The identity the server serves now; null before the first frame or when it has none. */
  server: string | null;
  visible: boolean;
  /** The tab was shown (or loaded) moments ago and has had no pointer or key input since. */
  freshShow: boolean;
  /** Reasons a reload would lose something now (`lib/reload-blockers.ts`). */
  blockers: readonly string[];
  /**
   * The server build an earlier reload in this tab went for, null for none,
   * or `unavailable` when tab storage cannot be read or written — then the
   * loop guard cannot work, so the page never reloads by itself.
   */
  attempted: string | null | "unavailable";
}

export function decideBuildAction(input: BuildDecisionInput): BuildAction {
  if (input.client === null || input.server === null || input.client === input.server) return "none";
  if (!input.visible) return "wait";
  if (input.attempted === "unavailable" || input.attempted === input.server) return "banner";
  if (!input.freshShow || input.blockers.length > 0) return "banner";
  return "reload";
}
