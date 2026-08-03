/**
 * tRPC router for landmark cards.
 *
 * Reads every `**\/*.landmark.card` in the box, parses its frontmatter,
 * and resolves its `navigation` links into a flat list ready to render.
 * Cards that exist but don't parse ride along in `problems` (same shape as
 * `chat.byLandmark`'s), so the Landmarks page can say a landmark is missing
 * rather than silently dropping it. See docs/landmarks.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import {
  resolveLandmark,
  type ResolvedLink,
  type ResolvedGroup,
} from "../../../core/landmark/resolve.js";
import { readLandmarkFeatures } from "../../../core/landmark/features.js";
import type { LandmarkProblem } from "../../../core/landmark/summaries.js";
import { parseLandmarkFields, type LandmarkNavigationData } from "../../../schemas/landmark.js";
import { parseRef, resolveRefPath } from "../../../shared/ref-path.js";
import { errorMessage } from "../../../lib/error-guards.js";

export interface LandmarkPayload {
  /** Box-relative path of the landmark card. */
  path: string;
  /** Box-relative directory containing the landmark. */
  dir: string;
  /** Label text (falls back to filename-derived title). */
  label: string;
  /** Symbol text (emoji or short text); empty when an image is used. */
  symbol: string;
  /** Box-relative path to the symbol image, or null for text symbols. */
  symbolSrc: string | null;
  /** Resolved hand-listed + unnamed-expand links, in source order with dedup. */
  links: ResolvedLink[];
  /** Named expands kept as collapsible groups (submenus). */
  groups: ResolvedGroup[];
  /**
   * Chat-feature seeds (e.g. `{ narration: "on" }`) declared via
   * `navigation.chat-app`. Applied at session-open time for chats bound
   * to this landmark's directory.
   */
  features: Record<string, string>;
}

/**
 * Pull the navigation `symbol`'s text and image src (if any). A string
 * symbol is text; a `{ src }` symbol is an image whose path is resolved
 * through the shared ref algebra (`src/shared/ref-path.ts`, against the
 * landmark card) into the box-relative form the frontend pipes straight to
 * /api/files. A src that escapes the box resolves to nothing and is reported
 * as no symbol at all — a visible absence rather than a path outside the box.
 */
function readSymbol(
  navigation: LandmarkNavigationData | undefined,
  { landmarkPath }: { landmarkPath: string },
): { text: string; src: string | null } {
  const symbol = navigation?.symbol;
  if (symbol === undefined) return { text: "", src: null };
  if (typeof symbol === "string") return { text: symbol.trim(), src: null };
  const resolved = resolveRefPath({
    fromPath: landmarkPath,
    ref: parseRef(symbol.src).path,
    kind: "card",
  });
  if (resolved === null) {
    console.warn(`landmarks: symbol src "${symbol.src}" in ${landmarkPath} escapes the box`);
    return { text: "", src: null };
  }
  return { text: "", src: resolved };
}

/**
 * Outcome of reading one landmark card. A card that exists but doesn't parse
 * is a distinct failure from one we couldn't read at all: the first is a
 * hand-edit the boxholder can fix and is surfaced as a `problem`, the second
 * is an fs error we've already warned about and can say nothing useful about.
 */
type LandmarkLoad =
  | { status: "ok"; payload: LandmarkPayload }
  | { status: "unparsed" }
  | { status: "unreadable" };

/**
 * Read one `*.landmark.card` file and resolve it into a payload.
 * `relPath` is box-relative.
 */
async function loadLandmarkPayload(
  relPath: string,
  { boxRoot }: { boxRoot: string },
): Promise<LandmarkLoad> {
  const absPath = path.join(boxRoot, relPath);
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
  const dir = path.dirname(relPath);
  const landmarkDir = path.dirname(absPath);
  const { links, groups } = await resolveLandmark(navigation, {
    landmarkDir,
    landmarkPath: relPath,
    boxRoot,
  });
  const symbol = readSymbol(navigation, { landmarkPath: relPath });

  return {
    status: "ok",
    payload: {
      path: relPath,
      dir: dir === "." ? "" : dir,
      // Filename-basename fallback, matching `loadLandmarkSummaries`: a
      // label-less card (e.g. a destinations-only landmark) must never ship
      // an empty label — the app bar renders it as a blank pill face.
      label: (navigation?.label ?? "") || path.basename(relPath, ".landmark.card"),
      symbol: symbol.text,
      symbolSrc: symbol.src,
      links,
      groups,
      features: readLandmarkFeatures(navigation),
    },
  };
}

export const landmarksRouter = router({
  list: publicProcedure.query(async ({ ctx }): Promise<{
    landmarks: LandmarkPayload[];
    problems: LandmarkProblem[];
  }> => {
    const matches = await glob("**/*.landmark.card", {
      cwd: ctx.boxRoot,
      nodir: true,
      ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
    });

    const payloads: LandmarkPayload[] = [];
    const problems: LandmarkProblem[] = [];

    for (const relPath of matches) {
      const load = await loadLandmarkPayload(relPath, { boxRoot: ctx.boxRoot });
      if (load.status === "ok") payloads.push(load.payload);
      else if (load.status === "unparsed") problems.push({ path: relPath });
    }
    problems.sort((a, b) => a.path.localeCompare(b.path));

    // Stable, predictable order: root first, then lexicographic by dir. The
    // Landmarks page re-orders by chat activity (`chat.byLandmark`'s sort);
    // this is what a consumer that doesn't gets.
    payloads.sort((a, b) => {
      if (a.dir === "" && b.dir !== "") return -1;
      if (b.dir === "" && a.dir !== "") return 1;
      return a.dir.localeCompare(b.dir);
    });

    return { landmarks: payloads, problems };
  }),

  /**
   * Resolve the single landmark living directly in `dir` (box-relative,
   * `""` for the root), or null when that directory has none. Used by the
   * chat header to surface the scoped landmark's links without resolving
   * every landmark in the box (as `list` does). `dir` is rejected if it
   * could escape the box.
   */
  forDir: publicProcedure
    .input(
      z.object({
        dir: z
          .string()
          .refine(
            (d) => !d.startsWith("/") && !d.split("/").includes(".."),
            "dir must be box-relative and contain no '..' segments",
          ),
      }),
    )
    .query(async ({ ctx, input }): Promise<{ landmark: LandmarkPayload | null }> => {
      const pattern = input.dir === "" ? "*.landmark.card" : `${input.dir}/*.landmark.card`;
      const matches = await glob(pattern, {
        cwd: ctx.boxRoot,
        nodir: true,
        ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
      });
      // One landmark per directory by convention; take the first match.
      const relPath = matches.toSorted()[0];
      if (relPath === undefined) return { landmark: null };
      const load = await loadLandmarkPayload(relPath, { boxRoot: ctx.boxRoot });
      return { landmark: load.status === "ok" ? load.payload : null };
    }),
});
