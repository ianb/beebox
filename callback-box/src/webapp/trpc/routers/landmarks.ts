/**
 * tRPC router for landmark cards.
 *
 * Reads every `**\/*.landmark.card` in the box, parses its frontmatter,
 * and resolves its `navigation` links into a flat list ready to render.
 * See docs/landmarks.md.
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
import { parseLandmarkFields, type LandmarkNavigationData } from "../../../schemas/landmark.js";
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
 * Pull the navigation `symbol`'s text and image src (if any). A string
 * symbol is text; a `{ src }` symbol is an image whose path is resolved
 * from "relative to landmark directory" to "box-relative" so the frontend
 * can pipe it directly to /api/files.
 */
function readSymbol(
  navigation: LandmarkNavigationData | undefined,
  { landmarkDir, boxRoot }: { landmarkDir: string; boxRoot: string },
): { text: string; src: string | null } {
  const symbol = navigation?.symbol;
  if (symbol === undefined) return { text: "", src: null };
  if (typeof symbol === "string") return { text: symbol.trim(), src: null };
  const absolute = path.resolve(landmarkDir, symbol.src);
  return { text: "", src: path.relative(boxRoot, absolute) };
}

/**
 * Read one `*.landmark.card` file and resolve it into a payload, or null
 * when it can't be read or has no frontmatter. `relPath` is box-relative.
 */
async function loadLandmarkPayload(
  relPath: string,
  { boxRoot }: { boxRoot: string },
): Promise<LandmarkPayload | null> {
  const absPath = path.join(boxRoot, relPath);
  let fields;
  try {
    const content = await fs.readFile(absPath, "utf-8");
    fields = parseLandmarkFields(content);
  } catch (e) {
    console.warn(`landmarks: failed to read ${relPath}: ${errorMessage(e)}`);
    return null;
  }
  if (fields === null) return null;

  const navigation = fields.navigation;
  const dir = path.dirname(relPath);
  const landmarkDir = path.dirname(absPath);
  const { links, groups } = await resolveLandmark(navigation, { landmarkDir, boxRoot });
  const symbol = readSymbol(navigation, { landmarkDir, boxRoot });

  return {
    path: relPath,
    dir: dir === "." ? "" : dir,
    label: navigation?.label ?? "",
    symbol: symbol.text,
    symbolSrc: symbol.src,
    links,
    groups,
    depth: 0,
    features: readLandmarkFeatures(navigation),
  };
}

export const landmarksRouter = router({
  list: publicProcedure.query(async ({ ctx }): Promise<{ landmarks: LandmarkPayload[] }> => {
    const matches = await glob("**/*.landmark.card", {
      cwd: ctx.boxRoot,
      nodir: true,
      ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
    });

    const payloads: LandmarkPayload[] = [];

    for (const relPath of matches) {
      const payload = await loadLandmarkPayload(relPath, { boxRoot: ctx.boxRoot });
      if (payload !== null) payloads.push(payload);
    }

    // Sort by dir so each landmark follows its nearest landmark ancestor:
    // root first, then lexicographic by dir (a parent dir always lex-precedes
    // its child dirs because "Parent" < "Parent/Child").
    payloads.sort((a, b) => {
      if (a.dir === "" && b.dir !== "") return -1;
      if (b.dir === "" && a.dir !== "") return 1;
      return a.dir.localeCompare(b.dir);
    });

    // Assign depth: each landmark's depth is 1 + the depth of its nearest
    // ancestor landmark. The root landmark is special — it pins to the top
    // but doesn't act as a parent, so top-level landmarks stay at depth 0.
    const byDir = new Map<string, LandmarkPayload>();
    for (const lm of payloads) byDir.set(lm.dir, lm);
    for (const lm of payloads) {
      if (lm.dir === "") {
        lm.depth = 0;
        continue;
      }
      let cursor = path.dirname(lm.dir);
      if (cursor === ".") cursor = "";
      let depth = 0;
      while (cursor !== "") {
        const ancestor = byDir.get(cursor);
        if (ancestor) {
          depth = ancestor.depth + 1;
          break;
        }
        const next = path.dirname(cursor);
        cursor = next === "." ? "" : next;
      }
      lm.depth = depth;
    }

    return { landmarks: payloads };
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
      const landmark = await loadLandmarkPayload(relPath, { boxRoot: ctx.boxRoot });
      return { landmark };
    }),
});
