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
import { router, publicProcedure, ownerProcedure } from "../trpc.js";
import {
  resolveLandmark,
  type ResolvedLink,
  type ResolvedGroup,
} from "../../../core/landmark/resolve.js";
import { readLandmarkFeatures } from "../../../core/landmark/features.js";
import type { LandmarkProblem } from "../../../core/landmark/summaries.js";
import { parseLandmarkFields } from "../../../schemas/landmark.js";
import { readLandmarkSymbol } from "../../../core/landmark/symbol.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { loadHqDictationDefault } from "../../../core/box/config.js";
import { setLandmarkHqPreference } from "../../../core/landmark/hq-preference.js";

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
  const symbol = readLandmarkSymbol(navigation, { landmarkPath: relPath });

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
      // Overwritten by the ancestor traversal in `list` after sorting.
      depth: 0,
      features: readLandmarkFeatures(navigation),
    },
  };
}

export const landmarksRouter = router({
  hqPreferences: ownerProcedure
    .input(z.object({ dir: z.string().refine((d) => !d.startsWith("/") && !d.split("/").includes("..")).nullable() }))
    .query(async ({ ctx, input }) => {
      const pattern = input.dir === null ? null : input.dir === "" ? "*.landmark.card" : `${input.dir}/*.landmark.card`;
      const matches = pattern === null ? [] : await glob(pattern, { cwd: ctx.boxRoot, nodir: true });
      const relPath = matches.toSorted()[0];
      let landmark: "inherit" | "on" | "off" = "inherit";
      if (relPath !== undefined) {
        const loaded = await loadLandmarkPayload(relPath, { boxRoot: ctx.boxRoot });
        const value = loaded.status === "ok" ? loaded.payload.features["hq-dictation"] : undefined;
        if (value === "on" || value === "off") landmark = value;
      }
      return { box: await loadHqDictationDefault(ctx.boxRoot), landmark, hasLandmark: relPath !== undefined };
    }),

  setHqPreference: ownerProcedure
    .input(z.object({
      dir: z.string().refine((d) => !d.startsWith("/") && !d.split("/").includes("..")),
      value: z.enum(["inherit", "on", "off"]),
    }))
    .mutation(async ({ ctx, input }) => setLandmarkHqPreference({
      boxRoot: ctx.boxRoot,
      contextDir: input.dir,
      value: input.value,
    })),
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

    // Sort by dir so each landmark follows its nearest landmark ancestor:
    // root first, then lexicographic by dir (a parent dir always lex-precedes
    // its child dirs because "Parent" < "Parent/Child"). This directory
    // grouping IS the Landmarks page's order — the page is the box's map,
    // and scattering related landmarks by chat recency destroyed the sense
    // of place (boxholder, 2026-08-03); recency ordering lives in the app
    // bar's switch menu instead.
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
