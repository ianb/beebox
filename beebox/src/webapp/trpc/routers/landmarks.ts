/**
 * tRPC router for landmark cards.
 *
 * Reads every `**\/*.landmark.card` in the box, parses its frontmatter,
 * and resolves its `navigation` links into a flat list ready to render.
 * Cards that exist but don't parse ride along in `problems` (same shape as
 * `chat.byLandmark`'s), so the Landmarks page can say a landmark is missing
 * rather than silently dropping it. See docs/landmarks.md.
 */

import * as path from "node:path";
import { glob } from "glob";
import { z } from "zod";
import { router, publicProcedure, ownerProcedure } from "../trpc.js";
import { boxRelativePathSchema } from "../../../core/landmark/nearest.js";
import type { LandmarkProblem } from "../../../core/landmark/summaries.js";
import { landmarkScanRelDir } from "../../../core/landmark/root-dir.js";
import { isListedLandmark } from "../../../core/landmark/cascade.js";
import { loadHqDictationDefault } from "../../../core/box/config.js";
import { setLandmarkHqPreference } from "../../../core/landmark/hq-preference.js";
import {
  loadLandmarkPayload,
  loadLandmarkIdentity,
  assertLandmarkDirInNamespace,
  type LandmarkPayload,
  type LandmarkIdentity,
} from "./landmark-payload.js";

export type { LandmarkPayload, LandmarkIdentity } from "./landmark-payload.js";

export const landmarksRouter = router({
  hqPreferences: ownerProcedure
    .input(z.object({ dir: z.string().refine((d) => !d.startsWith("/") && !d.split("/").includes("..")).nullable() }))
    .query(async ({ ctx, input }) => {
      if (input.dir !== null) await assertLandmarkDirInNamespace({ boxRoot: ctx.boxRoot, dir: input.dir, mode: "read" });
      const pattern = input.dir === null ? null : `${landmarkScanRelDir(input.dir)}/*.landmark.card`;
      const matches = pattern === null ? [] : await glob(pattern, { cwd: ctx.boxRoot, nodir: true });
      const relPath = matches.toSorted()[0];
      let landmark: "inherit" | "on" | "off" = "inherit";
      if (relPath !== undefined) {
        const loaded = await loadLandmarkPayload(relPath, { boxRoot: ctx.boxRoot, derive: false });
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
    .mutation(async ({ ctx, input }) => {
      await assertLandmarkDirInNamespace({ boxRoot: ctx.boxRoot, dir: input.dir, mode: "write" });
      return setLandmarkHqPreference({
        boxRoot: ctx.boxRoot,
        contextDir: input.dir,
        value: input.value,
      });
    }),
  list: publicProcedure.query(async ({ ctx }): Promise<{
    landmarks: LandmarkPayload[];
    problems: LandmarkProblem[];
  }> => {
    const matches = await glob("**/*.landmark.card", {
      cwd: ctx.boxRoot,
      nodir: true,
      ignore: ["node_modules/**", ".git/**", "_tmp/**", ".beebox/**"],
    });

    const payloads: LandmarkPayload[] = [];
    const problems: LandmarkProblem[] = [];

    for (const relPath of matches) {
      const load = await loadLandmarkPayload(relPath, { boxRoot: ctx.boxRoot, derive: true });
      if (load.status === "ok") {
        payloads.push(load.payload);
        problems.push(...load.derivedProblems);
      } else if (load.status === "unparsed") {
        problems.push({ kind: "landmark-parse", path: relPath });
      }
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

    // Box-wide background cascade: drop a landmark written `background`, and
    // any landmark with a `background` ancestor landmark.
    const listed = payloads.filter((lm) => isListedLandmark(lm, payloads));

    return { landmarks: listed, problems };
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
        dir: boxRelativePathSchema,
      }),
    )
    .query(async ({ ctx, input }): Promise<{ landmark: LandmarkPayload | null }> => {
      await assertLandmarkDirInNamespace({ boxRoot: ctx.boxRoot, dir: input.dir, mode: "read" });
      const pattern = `${landmarkScanRelDir(input.dir)}/*.landmark.card`;
      const matches = await glob(pattern, {
        cwd: ctx.boxRoot,
        nodir: true,
        ignore: ["node_modules/**", ".git/**", "_tmp/**", ".beebox/**"],
      });
      // One landmark per directory by convention; take the first match.
      const relPath = matches.toSorted()[0];
      if (relPath === undefined) return { landmark: null };
      const load = await loadLandmarkPayload(relPath, { boxRoot: ctx.boxRoot, derive: true });
      if (load.status !== "ok") return { landmark: null };
      // No `problems` channel here (this is the mount-scoped, per-directory
      // read, not the box-wide scan) — a derived link that vanished between
      // the walk and resolution is logged and dropped rather than shown
      // missing, same as `derivedProblems`' doc comment says.
      for (const problem of load.derivedProblems) {
        console.warn(`landmarks.forDir: ${problem.path} (linked from ${problem.landmarkPath}): ${problem.message}`);
      }
      return { landmark: load.payload };
    }),

  /**
   * Label, symbol, path, and the written `prominence` for the landmark
   * living directly in `dir` — no link/expand resolution, no pruned-subtree
   * walk. For the mount-path callers that only need to know WHERE they are
   * (`PlacePill`'s face, `DocumentIcon`, `DocumentPlace`, `ChatBarChrome`);
   * `forDir` stays the one to call when the caller actually renders a link
   * list. See `loadLandmarkIdentity`'s header.
   */
  identity: publicProcedure
    .input(
      z.object({
        dir: boxRelativePathSchema,
      }),
    )
    .query(async ({ ctx, input }): Promise<{ identity: LandmarkIdentity | null }> => {
      await assertLandmarkDirInNamespace({ boxRoot: ctx.boxRoot, dir: input.dir, mode: "read" });
      const pattern = `${landmarkScanRelDir(input.dir)}/*.landmark.card`;
      const matches = await glob(pattern, {
        cwd: ctx.boxRoot,
        nodir: true,
        ignore: ["node_modules/**", ".git/**", "_tmp/**", ".beebox/**"],
      });
      const relPath = matches.toSorted()[0];
      if (relPath === undefined) return { identity: null };
      const identity = await loadLandmarkIdentity(relPath, { boxRoot: ctx.boxRoot });
      return { identity: typeof identity === "string" ? null : identity };
    }),
});
