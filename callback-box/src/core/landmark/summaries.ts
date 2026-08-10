/**
 * Tile-level landmark metadata — every landmark card's directory, label, and
 * symbol, without resolving links or `expand`.
 *
 * Backs the chat picker (`chat.byLandmark`) and the history dropdown's
 * landmark tags (`chat.sessions`). Lives in core/ rather than the router that
 * first needed it so both can read it without importing each other.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseLandmarkFields } from "../../schemas/landmark.js";
import { readLandmarkCard } from "./card-cache.js";
import { readLandmarkSymbol } from "./symbol.js";
import { mapInBatchesSettled } from "../../lib/map-batched.js";
import { errnoCode } from "../../lib/error-guards.js";

/** Landmark cards read at once — see {@link mapInBatchesSettled}. */
const READ_CONCURRENCY = 64;

/**
 * Display label for each of a known set of landmark directories ("" = the box
 * root), keyed by directory. A directory with no landmark card — or an
 * unreadable one — is absent from the map; callers decide the fallback.
 *
 * Reads only the named directories, unlike `loadLandmarkSummaries`, which globs
 * the whole box. Use this when you already know which dirs you care about (the
 * history dropdown resolves a handful of session bindings on every open, and a
 * full-tree traversal per open is a real cost on a large box).
 */
export async function landmarkLabelsForDirs(
  boxRoot: string,
  dirs: Iterable<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    [...new Set(dirs)].map(async (dir) => {
      const absDir = path.join(boxRoot, dir);
      let names: string[];
      try {
        names = await fs.readdir(absDir);
      } catch (e) {
        if (errnoCode(e) !== "ENOENT") {
          console.warn(`landmark label: could not read ${absDir}:`, e);
        }
        return;
      }
      const cardName = names.find((n) => n.endsWith(".landmark.card"));
      if (cardName === undefined) return;
      let fields;
      try {
        fields = parseLandmarkFields(await fs.readFile(path.join(absDir, cardName), "utf-8"));
      } catch (e) {
        console.warn(`landmark label: could not read ${path.join(absDir, cardName)}:`, e);
        return;
      }
      if (fields === null) return;
      const label = fields.navigation?.label ?? "";
      out.set(dir, label !== "" ? label : path.basename(cardName, ".landmark.card"));
    }),
  );
  return out;
}

export interface LandmarkSummary {
  /**
   * Box-relative path of the landmark card. The identity of the summary: a
   * directory is *supposed* to hold one landmark card but nothing enforces it,
   * so `dir` alone doesn't distinguish two summaries (and doesn't make a stable
   * React key).
   */
  path: string;
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
}

/** A `*.landmark.card` that exists but doesn't parse as a landmark. */
export interface LandmarkProblem {
  /** Box-relative path of the offending card. */
  path: string;
}

export interface LandmarkSummaries {
  summaries: LandmarkSummary[];
  /**
   * Cards whose frontmatter failed to parse or validate. Reported rather than
   * silently skipped: once a landmark is the only way to reach an activity, a
   * hand-edit must not make it vanish without trace.
   */
  problems: LandmarkProblem[];
}

/**
 * One card's contribution to the summaries: its tile metadata, a parse
 * `problem`, or null when the file couldn't be read at all (there's nothing to
 * say about a card we never saw).
 */
type CardOutcome =
  | { problem: false; summary: LandmarkSummary }
  | { problem: true; path: string };

async function readSummary(boxRoot: string, relPath: string): Promise<CardOutcome | null> {
  const absPath = path.join(boxRoot, relPath);
  let fields;
  try {
    fields = await readLandmarkCard(absPath);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Skipping unreadable landmark card ${absPath}:`, e);
    }
    return null;
  }
  if (fields === null) return { problem: true, path: relPath };

  const navigation = fields.navigation;
  const dir = path.dirname(relPath);
  const symbol = readLandmarkSymbol(navigation, { landmarkPath: relPath });
  return {
    problem: false,
    summary: {
      path: relPath,
      dir: dir === "." ? "" : dir,
      label: (navigation === undefined ? "" : navigation.label ?? "") || path.basename(relPath, ".landmark.card"),
      symbol: symbol.text,
      symbolSrc: symbol.src,
    },
  };
}

/**
 * Like `landmarks.list` but without resolving links/expand — just the
 * tile-level metadata the picker needs. Reads each card's YAML frontmatter
 * `navigation` (label + symbol); cards whose frontmatter doesn't parse as a
 * landmark are reported in `problems` rather than skipped silently. An
 * unreadable file (an fs error) is a different failure — it warns and is left
 * out of both lists, since there's nothing to say about a card we never read.
 *
 * Exported for the chat-picker regression doctest: this read once used the XML
 * `parseCard`, which silently threw on every (now-frontmatter) landmark card
 * and left the picker landmark-less.
 */
export async function loadLandmarkSummaries(boxRoot: string): Promise<LandmarkSummaries> {
  const matches = await glob("**/*.landmark.card", {
    cwd: boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
  });

  // Read the cards concurrently — they're independent files and the picker
  // waits on all of them — but in bounded batches, not one handle per card at
  // once: a large box has enough landmarks to matter, and this codebase has
  // already been bitten by fd exhaustion (see core/box/file-watcher.ts's
  // header). `allSettled` per code-style; an unreadable card is already handled
  // per-card below and must not abandon the rest.
  const read = await mapInBatchesSettled(matches, {
    size: READ_CONCURRENCY,
    map: (relPath) => readSummary(boxRoot, relPath),
  });

  const out: LandmarkSummary[] = [];
  const problems: LandmarkProblem[] = [];
  for (const [i, outcome] of read.entries()) {
    if (outcome.status === "rejected") {
      console.warn(`Skipping landmark card ${matches[i]}:`, outcome.reason);
      continue;
    }
    if (outcome.value === null) continue;
    if (outcome.value.problem) problems.push({ path: outcome.value.path });
    else out.push(outcome.value.summary);
  }
  out.sort((a, b) => {
    // Root first, then alphabetical.
    if (a.dir === "") return -1;
    if (b.dir === "") return 1;
    return a.dir.localeCompare(b.dir);
  });
  problems.sort((a, b) => a.path.localeCompare(b.path));
  return { summaries: out, problems };
}
