/**
 * The places the intention review walks, and what changed under each
 * (docs/implemented-plans/place-intention.md, Track D).
 *
 * A place is a `*.landmark.card` and the directory it sits in, minus any
 * subdirectory with its own landmark: that subdirectory is its own place, the
 * same boundary the landmark's derived links stop at. The root landmark
 * (`_content/`) therefore covers `_content/` outside every other place.
 * Parked template mirrors and machine state are not places.
 */

import * as path from "node:path";
import { glob } from "glob";
import { boxGit } from "../../lib/git/env.js";

export interface Place {
  /** Box-relative path of the landmark card. */
  landmark: string;
  /** Box-relative directory the landmark sits in. */
  dir: string;
  /** Directories of other places strictly under `dir`. */
  nested: string[];
}

const IGNORE = ["node_modules/**", ".git/**", "_tmp/**", ".beebox/**", "_config/_template-updates/**"];

function inside(dir: string, relPath: string): boolean {
  return dir === "." || relPath === dir || relPath.startsWith(`${dir}/`);
}

/** Whether `relPath` belongs to `place`: under its directory and not under a nested place. */
export function ownsPath(place: Place, relPath: string): boolean {
  return inside(place.dir, relPath) && !place.nested.some((dir) => inside(dir, relPath));
}

/** Every place in the box, sorted by landmark path. */
export async function findPlaces(boxRoot: string): Promise<Place[]> {
  const landmarks = (await glob("**/*.landmark.card", { cwd: boxRoot, nodir: true, posix: true, ignore: IGNORE })).toSorted();
  const dirs = landmarks.map((landmark) => path.posix.dirname(landmark));
  return landmarks.map((landmark) => {
    const dir = path.posix.dirname(landmark);
    const nested = [...new Set(dirs.filter((other) => other !== dir && inside(dir, other)))];
    return { landmark, dir, nested };
  });
}

function pathspec(place: Place): string[] {
  return [place.dir, ...place.nested.map((dir) => `:(exclude)${dir}`)];
}

function uniqueLines(out: string): string[] {
  return [...new Set(out.split("\n").filter((line) => line !== ""))];
}

/**
 * Paths under the place that commits in `from..HEAD` touched, newest first.
 * Throws when `from` is not a commit of this history.
 */
export async function changedSince(boxRoot: string, { place, from }: { place: Place; from: string }): Promise<string[]> {
  const out = await boxGit(boxRoot).raw([
    "-c", "core.quotePath=false", "log", "--name-only", "--format=", `${from}..HEAD`, "--", ...pathspec(place),
  ]);
  return uniqueLines(out);
}

/** Paths under the place touched by its most recent commits (at most `commits` of them), newest first. */
export async function recentlyChanged(boxRoot: string, { place, commits }: { place: Place; commits: number }): Promise<string[]> {
  const out = await boxGit(boxRoot).raw([
    "-c", "core.quotePath=false", "log", "--name-only", "--format=", "-n", String(commits), "HEAD", "--", ...pathspec(place),
  ]);
  return uniqueLines(out);
}
