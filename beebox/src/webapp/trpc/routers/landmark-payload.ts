/**
 * Read one `*.landmark.card` file into the wire shapes `landmarks.ts`'s
 * procedures ship: the full resolved `LandmarkPayload` (links, groups,
 * derived children) and the cheap `LandmarkIdentity` (label/symbol/path/
 * prominence only). Split out of `landmarks.ts` to stay under the file
 * budget — these are pure loaders, no router wiring.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import {
  resolveLandmark,
  type ResolvedLink,
  type ResolvedGroup,
} from "../../../core/landmark/resolve.js";
import { readLandmarkFeatures } from "../../../core/landmark/features.js";
import type { DerivedReadProblem } from "../../../core/landmark/summaries.js";
import { parseLandmarkFields } from "../../../schemas/landmark.js";
import { readLandmarkSymbol } from "../../../core/landmark/symbol.js";
import { normalizeLandmarkDir, landmarkScanRelDir } from "../../../core/landmark/root-dir.js";
import { readLandmarkCard } from "../../../core/landmark/card-cache.js";
import { prunedSubtree } from "../../../core/landmark/prominence-index.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { resolveBoxNamespacePathOnDisk, type BoxNamespaceAccessMode } from "../../../lib/box-namespace-resolve.js";
import type { CardSymbolData } from "../../../shared/card-symbol.js";
import type { ProminenceLevel } from "../../../shared/prominence.js";

export interface LandmarkPayload {
  /** Box-relative path of the landmark card. */
  path: string;
  /** Box-relative directory containing the landmark. */
  dir: string;
  /** Label text (falls back to filename-derived title). */
  label: string;
  /**
   * The landmark's mark — the card's own `symbol` group, with `src` resolved to
   * a box-relative path. Null when the card has none.
   */
  symbol: CardSymbolData | null;
  /** The landmark's own WRITTEN `prominence` (the place-level cascade field), null when absent. */
  prominence: ProminenceLevel | null;
  /** Resolved listed + derived + unnamed-expand links, in tier order with dedup. */
  links: ResolvedLink[];
  /** Named expands kept as collapsible groups (submenus). */
  groups: ResolvedGroup[];
  /** Nesting depth relative to ancestor landmarks (root = 0). */
  depth: number;
  /**
   * Chat-feature seeds (e.g. `{ narration: "on" }`) declared via
   * `navigation.chat-app`. Applied at session-open time for chats bound
   * to this landmark's directory.
   */
  features: Record<string, string>;
}

/**
 * Outcome of reading one landmark card. A card that exists but doesn't parse
 * is a distinct failure from one we couldn't read at all: the first is a
 * hand-edit the boxholder can fix and is surfaced as a `problem`, the second
 * is an fs error we've already warned about and can say nothing useful about.
 */
type LandmarkLoad =
  | { status: "ok"; payload: LandmarkPayload; derivedProblems: DerivedReadProblem[] }
  | { status: "unparsed" }
  | { status: "unreadable" };

/**
 * Read one `*.landmark.card` file and resolve it into a payload.
 * `relPath` is box-relative. `derive: true` runs the Track B pruned-subtree
 * walk and splices its entries into the resolved link list (`list`,
 * `forDir`); `derive: false` skips that walk entirely for callers that only
 * need `features` (`hqPreferences`).
 *
 * Finding 2 (round 4 hardening): a glob match is just a name that satisfied
 * `**\/*.landmark.card` on disk — it says nothing about where the path
 * actually RESOLVES to. `_content/A.landmark.card -> ../src/private.landmark.card`
 * matches the glob and reads back as a real landmark, but its bytes are
 * `src/private.landmark.card` — outside every underscore area. Every landmark
 * card this router reads goes through `resolveBoxNamespacePathOnDisk` (read
 * mode) FIRST, so a symlinked card whose target escapes the box namespace is
 * refused before `fs.readFile` ever follows the link — the same fence
 * `forDir`/`list`'s directory-level checks already apply to the scan ROOT,
 * now applied to each individual card path too.
 */
export async function loadLandmarkPayload(
  relPath: string,
  { boxRoot, derive }: { boxRoot: string; derive: boolean },
): Promise<LandmarkLoad> {
  const ns = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: relPath, mode: "read" });
  if (!ns.ok) {
    console.warn(`landmarks: ${relPath} is outside the box namespace (symlink escape?) — skipping`);
    return { status: "unreadable" };
  }
  const absPath = ns.resolved;
  let fields;
  try {
    const content = await fs.readFile(absPath, "utf-8");
    fields = parseLandmarkFields(content);
  } catch (e) {
    console.warn(`landmarks: failed to read ${relPath}: ${errorMessage(e)}`);
    return { status: "unreadable" };
  }
  if (fields === null) return { status: "unparsed" };

  const navigation = fields.navigation;
  const dir = normalizeLandmarkDir(path.dirname(relPath));
  const landmarkDir = path.dirname(absPath);
  const derived = derive ? await prunedSubtree(boxRoot, dir) : undefined;
  const { links, groups, derivedProblems } = await resolveLandmark(navigation, {
    landmarkDir,
    landmarkPath: relPath,
    boxRoot,
    ...(derived === undefined ? {} : { derived }),
  });
  const symbol = readLandmarkSymbol(fields, { landmarkPath: relPath });

  return {
    status: "ok",
    payload: {
      path: relPath,
      dir,
      // Filename-basename fallback, matching `loadLandmarkSummaries`: a
      // label-less card (e.g. a destinations-only landmark) must never ship
      // an empty label — the app bar renders it as a blank pill face.
      label: (navigation?.label ?? "") || path.basename(relPath, ".landmark.card"),
      symbol,
      prominence: fields.prominence ?? null,
      links,
      groups,
      // Overwritten by the ancestor traversal in `list` after sorting.
      depth: 0,
      features: readLandmarkFeatures(navigation),
    },
    derivedProblems,
  };
}

export interface LandmarkIdentity {
  /** Box-relative path of the landmark card. */
  path: string;
  /** Box-relative directory containing the landmark. */
  dir: string;
  /** Label text (falls back to filename-derived title). */
  label: string;
  symbol: CardSymbolData | null;
  /** The landmark's own WRITTEN `prominence` value (the place-level cascade field), null when absent. */
  prominence: ProminenceLevel | null;
}

/**
 * The cheap half of `loadLandmarkPayload`: label, symbol, and the written
 * `prominence` — no `navigation.links`/`expand` resolution, no pruned-subtree
 * walk. Backs `identity`, the mount-path query for callers that only need to
 * know WHERE they are (`PlacePill`'s face, `DocumentIcon`, `DocumentPlace`,
 * `ChatBarChrome`) — Track B splits this off so those don't pay for
 * derivation on every page load (see `docs/implemented-plans/card-prominence.md`,
 * "Split identity from resolution"). Reads through the shared parse cache
 * (`card-cache.ts`) that `loadLandmarkSummaries` already warms.
 */
export async function loadLandmarkIdentity(
  relPath: string,
  { boxRoot }: { boxRoot: string },
): Promise<LandmarkIdentity | "unparsed" | "unreadable"> {
  const ns = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: relPath, mode: "read" });
  if (!ns.ok) {
    console.warn(`landmarks: ${relPath} is outside the box namespace (symlink escape?) — skipping`);
    return "unreadable";
  }
  let fields;
  try {
    fields = await readLandmarkCard(ns.resolved);
  } catch (e) {
    console.warn(`landmarks: failed to read ${relPath}: ${errorMessage(e)}`);
    return "unreadable";
  }
  if (fields === null) return "unparsed";

  const dir = normalizeLandmarkDir(path.dirname(relPath));
  const symbol = readLandmarkSymbol(fields, { landmarkPath: relPath });
  const label = (fields.navigation?.label ?? "") || path.basename(relPath, ".landmark.card");
  return { path: relPath, dir, label, symbol, prominence: fields.prominence ?? null };
}

/**
 * Finding 3 (Track E hardening review, round 3): the tRPC-level `dir`
 * validation on the callers below (`!d.startsWith("/") && !d.split("/").includes("..")`)
 * rejects an escaping form but NOT a directory outside every underscore
 * area — `dir: "src/templates"` passes it and named a real on-disk
 * directory that `setHqPreference` then wrote a landmark card into. Resolve
 * the logical `dir` to its PHYSICAL box-relative directory
 * (`landmarkScanRelDir` — "" maps to the root scope's real home,
 * `_content/`) and require it inside the box namespace, checked on disk (so
 * a namespace-looking directory that's actually a symlink out doesn't pass
 * either). `mode: "write"` for the mutation, `"read"` for the queries.
 */
export async function assertLandmarkDirInNamespace(params: {
  boxRoot: string;
  dir: string;
  mode: BoxNamespaceAccessMode;
}): Promise<void> {
  const ns = await resolveBoxNamespacePathOnDisk({
    boxRoot: params.boxRoot,
    rawPath: landmarkScanRelDir(params.dir),
    mode: params.mode,
  });
  if (!ns.ok) {
    const message =
      ns.reason === "display-form" ? ns.message : `dir is outside the box namespace: ${params.dir}`;
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
}
