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
}

function readChildText(element: ElementNode, tagName: string): string {
  for (const child of element.children) {
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
  element: ElementNode,
  { landmarkDir, boxRoot }: { landmarkDir: string; boxRoot: string },
): { text: string; src: string | null } {
  for (const child of element.children) {
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
      const links = await resolveLandmark(element, {
        landmarkDir,
        boxRoot: ctx.boxRoot,
      });
      const symbol = readSymbol(element, { landmarkDir, boxRoot: ctx.boxRoot });

      payloads.push({
        path: relPath,
        dir: dir === "." ? "" : dir,
        label: readChildText(element, "label"),
        symbol: symbol.text,
        symbolSrc: symbol.src,
        links,
      });
    }

    payloads.sort((a, b) => a.path.localeCompare(b.path));
    return { landmarks: payloads };
  }),
});
