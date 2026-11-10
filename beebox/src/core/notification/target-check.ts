/**
 * Send-time checks a target needs against the box itself, beyond its grammar
 * (`target.ts`). A `chat:new:<place>` must name a directory that holds a
 * landmark card when it is sent, so a typo fails at the writer instead of at
 * the person's tap. The predicate matches the tap's (`landmarks.identity`):
 * the directory is inside the box namespace on disk, and its first landmark
 * card by name parses.
 */

import * as path from "node:path";
import { glob } from "glob";
import { resolveBoxNamespacePathOnDisk } from "../../lib/box-namespace-resolve.js";
import { readLandmarkCard } from "../landmark/card-cache.js";
import { errorMessage } from "../../shared/error-guards.js";
import { formatTarget, type Target } from "./target.js";

/** Why `target` cannot be sent from this box, or null when it can. */
export async function targetProblem(boxRoot: string, target: Target): Promise<string | null> {
  if (target.kind !== "chat-new" || target.place === undefined) return null;
  const refuse = (why: string) => `${formatTarget(target)}: no place at "${target.place}" (${why})`;
  // `landmarks.identity` globs with `_tmp/**` ignored: a place there is never found at tap time.
  if (target.place === "_tmp" || target.place.startsWith("_tmp/")) return refuse("_tmp holds no places");
  const dir = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: target.place, mode: "read" });
  if (!dir.ok) return refuse("the directory is outside the box");
  const [card] = (await glob("*.landmark.card", { cwd: dir.resolved, nodir: true })).toSorted();
  if (card === undefined) return refuse("the directory has no landmark card");
  const ns = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: path.posix.join(target.place, card), mode: "read" });
  if (!ns.ok) return refuse(`its landmark card ${card} is outside the box`);
  try {
    if ((await readLandmarkCard(ns.resolved)) === null) return refuse(`its landmark card ${card} does not parse`);
  } catch (e) {
    return refuse(`its landmark card ${card} could not be read: ${errorMessage(e)}`);
  }
  return null;
}

/** Thrown by `notifyBoxholder` for a target {@link targetProblem} refuses. */
export class UnsendableTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsendableTargetError";
  }
}
