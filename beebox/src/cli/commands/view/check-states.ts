/**
 * The check states `bbx view check` renders a view with
 * (docs/implemented-plans/view-check-settled-render.md, Track 1). Every view renders with
 * no card. A view that renders card types also renders with `params.path` set
 * to the first card of each type, by path, among the cards it receives: the
 * app opens it on such a card, and its "card not found" branch is all a
 * path-less render reaches. A type with no such card is reported untested.
 * Then each state the view declares in its `checkStates` export, by name
 * (docs/implemented-plans/view-declared-check-states.md).
 *
 * Also the records the children send the sweep: the `render-one` child's
 * remarks about a view that rendered but was not fully checked, and its
 * settled DOM per state; the `advise` child's advice.
 */

import { z } from "zod";
import { cardTypeFromName } from "../../../shared/card-name.js";
import type { DeclaredCheckState } from "../../../core/views/types.js";
import { viewAdviceSchema, type ViewAdvice } from "../../../core/views/advice/core.js";

/** One set of inputs the check renders a view with. */
export interface CheckState {
  /** `no card`, the sampled card's path, or a declared state's name. */
  label: string;
  params: Record<string, string>;
}

/** The states for a view, and the card types it was not checked on. */
export async function statesToCheck(opts: {
  rendersCardTypes: readonly string[];
  declared: readonly DeclaredCheckState[];
  boxCardPaths: readonly string[];
  /** Whether a card parses as the app would pass it. */
  loads: (cardPath: string) => Promise<boolean>;
}): Promise<{ states: CheckState[]; untested: string[] }> {
  const states: CheckState[] = [{ label: "no card", params: {} }];
  const untested: string[] = [];
  const sorted = opts.boxCardPaths.toSorted();
  for (const type of new Set(opts.rendersCardTypes)) {
    let found: string | null = null;
    for (const candidate of sorted.filter((p) => cardTypeFromName(p) === type)) {
      if (await opts.loads(candidate)) { found = candidate; break; }
    }
    if (found === null) untested.push(`no ${type} card among the cards the view receives (its dependencies); not checked with one`);
    else states.push({ label: found, params: { path: found } });
  }
  // A declared card that is gone (moved, archived, or outside the view's
  // dependencies), or of a type the view does not render (the app never opens
  // the view on it), is reported, not failed: a moved card must not wedge the check.
  for (const { name, path, params } of opts.declared) {
    const type = cardTypeFromName(path);
    if (type === undefined || !opts.rendersCardTypes.includes(type)) {
      untested.push(`state ${name}: the view does not render ${type ?? "this"} cards (rendersCardTypes), so the app never opens it on ${path}; not checked`);
    } else if (await opts.loads(path)) {
      states.push({ label: name, params: { ...params, path } });
    } else {
      untested.push(`state ${name}: ${path} is not among the cards the view receives; not checked`);
    }
  }
  return { states, untested };
}

/**
 * A line the child prints to stdout for each way a view was not fully
 * checked. The prefix sets it apart from anything view code prints.
 */
export const PARTIAL_PREFIX = "bbx-view-check partial: ";

/** How a remark says advice did not run for a view; the sweep skips advice after one from the render child. */
export const ADVICE_NOT_CHECKED = "advice not checked: ";

/** The partial-check remarks in a child's stdout. */
export function partialRemarks(stdout: string): string[] {
  return stdout.split("\n").filter((line) => line.startsWith(PARTIAL_PREFIX)).map((line) => line.slice(PARTIAL_PREFIX.length));
}

/** A line the `advise` child prints for each advice rule a view breaks. */
export const ADVICE_PREFIX = "bbx-view-check advice: ";

/** The advice in an `advise` child's stdout, and how many advice lines did not parse. */
export function adviceLines(stdout: string): { advice: ViewAdvice[]; unreadable: number } {
  const advice: ViewAdvice[] = [];
  let unreadable = 0;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith(ADVICE_PREFIX)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(ADVICE_PREFIX.length));
    } catch (_e) {
      unreadable += 1;
      continue;
    }
    const result = viewAdviceSchema.safeParse(parsed);
    if (result.success) advice.push(result.data);
    else unreadable += 1;
  }
  return { advice, unreadable };
}

/** A state's snapshot larger than this many UTF-8 bytes, as written, keeps no HTML; its advice is not checked. */
export const SNAPSHOT_MAX_BYTES = 5_000_000;

/**
 * One check state's settled DOM as the `render-one` child writes it for the
 * `advise` child: `html` is null when the state was over `SNAPSHOT_MAX_BYTES`.
 */
export const viewDomSnapshotSchema = z.strictObject({
  label: z.string(),
  html: z.string().nullable(),
  headStyles: z.array(z.string()),
});

export type ViewDomSnapshot = z.infer<typeof viewDomSnapshotSchema>;

/** A state's snapshot, with its HTML dropped when its JSON is over `SNAPSHOT_MAX_BYTES`. */
export function snapshotOf(label: string, dom: { html: string; headStyles: string[] }): ViewDomSnapshot {
  const full = { label, html: dom.html, headStyles: dom.headStyles };
  return Buffer.byteLength(JSON.stringify(full)) > SNAPSHOT_MAX_BYTES ? { label, html: null, headStyles: [] } : full;
}
