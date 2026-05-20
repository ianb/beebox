/**
 * tRPC router for landmark cards.
 *
 * Reads every `**\/*.landmark.card` in the box, parses it, and resolves
 * its `<link>` and `<expand>` children into a flat list ready to render.
 * See docs/landmarks.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseXml, type ElementNode } from "cardworks";
import { router, publicProcedure } from "../trpc.js";
import {
  resolveLandmark,
  type ResolvedLink,
} from "../../../core/landmark/resolve.js";
import { readLandmarkFeatures } from "../../../core/landmark/features.js";

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
  /** Resolved hand-listed + expanded links, in source order with dedup. */
  links: ResolvedLink[];
  /** Nesting depth relative to ancestor landmarks (root = 0). */
  depth: number;
  /**
   * Chat-feature seeds (e.g. `{ narration: "on" }`) declared via a
   * `<chat-app>` child of the landmark. Applied at session-open time
   * for chats bound to this landmark's directory.
   */
  features: Record<string, string>;
}

function findNavigation(element: ElementNode): ElementNode | null {
  for (const child of element.children) {
    if (child.tagName === "navigation") return child;
  }
  return null;
}

function readChildText(navigation: ElementNode | null, tagName: string): string {
  if (!navigation) return "";
  for (const child of navigation.children) {
    if (child.tagName === tagName && typeof child.text === "string") {
      return child.text.trim();
    }
  }
  return "";
}

/**
 * Pull `<symbol>`'s text and `src` attribute (if any). The `src` is
 * resolved from "relative to landmark directory" to "box-relative" so
 * the frontend can pipe it directly to /api/files.
 */
function readSymbol(
  navigation: ElementNode | null,
  { landmarkDir, boxRoot }: { landmarkDir: string; boxRoot: string },
): { text: string; src: string | null } {
  if (!navigation) return { text: "", src: null };
  for (const child of navigation.children) {
    if (child.tagName !== "symbol") continue;
    const rawSrc = child.attrs["src"];
    let src: string | null = null;
    if (typeof rawSrc === "string" && rawSrc !== "") {
      const absolute = path.resolve(landmarkDir, rawSrc);
      src = path.relative(boxRoot, absolute);
    }
    const text = typeof child.text === "string" ? child.text.trim() : "";
    return { text, src };
  }
  return { text: "", src: null };
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
      const absPath = path.join(ctx.boxRoot, relPath);
      let element: ElementNode;
      try {
        const content = await fs.readFile(absPath, "utf-8");
        element = await parseXml(content, absPath);
      } catch (e) {
        console.warn(`landmarks.list: failed to read ${relPath}: ${(e as Error).message}`);
        continue;
      }

      if (element.tagName !== "landmark") continue;

      const dir = path.dirname(relPath);
      const landmarkDir = path.dirname(absPath);
      const navigation = findNavigation(element);
      const links = await resolveLandmark(element, {
        landmarkDir,
        boxRoot: ctx.boxRoot,
      });
      const symbol = readSymbol(navigation, { landmarkDir, boxRoot: ctx.boxRoot });

      payloads.push({
        path: relPath,
        dir: dir === "." ? "" : dir,
        label: readChildText(navigation, "label"),
        symbol: symbol.text,
        symbolSrc: symbol.src,
        links,
        depth: 0,
        features: readLandmarkFeatures(element),
      });
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
});
