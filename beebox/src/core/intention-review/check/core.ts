/**
 * `bbx engine intentions check`, the precheck of the stock
 * `refresh-intentions` procedure (docs/plans/place-intention.md, Track D).
 *
 * Lists every place whose intention needs a look: never reviewed, changed
 * since the commit it was last reviewed at (the landmark's own commits count:
 * a summary rewrite is new evidence), or carrying an `intention.ref` that no
 * longer resolves. What closes the gate is the review record `verify` writes,
 * never a landmark edit, so a run that rightly changes nothing still settles
 * its places. Saves `HEAD` and the list as the open run, and returns the
 * brief; with nothing listed the run is cleared and nothing is returned.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getHeadSha } from "../../../lib/git-range.js";
import { parseLandmarkFields } from "../../../schemas/landmark.js";
import { resolvePrimeCard } from "../../landmark/intention.js";
import { changedSince, findPlaces, type Place } from "../places.js";
import { loadIntentionState, saveIntentionState } from "../state.js";
import { renderBrief, type ListedPlace } from "./brief.js";

export type IntentionCheckResult = { kind: "nothing" } | { kind: "review"; brief: string; listed: ListedPlace[] };

async function primeCardMissing(boxRoot: string, place: Place): Promise<boolean> {
  const fields = parseLandmarkFields(await fs.readFile(path.join(boxRoot, place.landmark), "utf-8"));
  const ref = fields?.intention?.ref;
  if (ref === undefined) return false;
  return (await resolvePrimeCard({ boxRoot, landmarkPath: place.landmark, ref })) === null;
}

/** Why `place` needs review, with what changed under it, or null when it does not. */
async function listing(boxRoot: string, { place, from }: { place: Place; from: string | undefined }): Promise<ListedPlace | null> {
  if (from === undefined) return { place, reason: "never reviewed", changed: [] };
  let changed: string[];
  try {
    changed = await changedSince(boxRoot, { place, from });
  } catch (e) {
    // The recorded commit left this history (a rewrite or a restore): review again.
    console.warn(`intentions: last review of ${place.landmark} (${from}) is not in this history:`, e);
    return { place, reason: "last review is not in this history", changed: [] };
  }
  if (changed.length > 0) return { place, reason: "changed since its last review", changed };
  if (await primeCardMissing(boxRoot, place)) return { place, reason: "its intention's card is gone", changed: [] };
  return null;
}

export async function checkIntentions(boxRoot: string): Promise<IntentionCheckResult> {
  const head = await getHeadSha(boxRoot);
  if (head === null) return { kind: "nothing" }; // no commits yet: nothing to review against
  const state = await loadIntentionState(boxRoot);
  const places = await findPlaces(boxRoot);
  const listed: ListedPlace[] = [];
  for (const place of places) {
    const entry = await listing(boxRoot, { place, from: state.reviewed[place.landmark] });
    if (entry !== null) listed.push(entry);
  }
  // A landmark that is gone no longer needs its record.
  const present = new Set(places.map((place) => place.landmark));
  const reviewed = Object.fromEntries(Object.entries(state.reviewed).filter(([landmark]) => present.has(landmark)));
  if (listed.length === 0) {
    await saveIntentionState(boxRoot, { reviewed, run: null });
    return { kind: "nothing" };
  }
  await saveIntentionState(boxRoot, { reviewed, run: { baseline: head, listed: listed.map((entry) => entry.place.landmark) } });
  return { kind: "review", brief: await renderBrief(boxRoot, listed), listed };
}
