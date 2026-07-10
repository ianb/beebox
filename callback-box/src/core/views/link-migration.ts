/**
 * One-time migration: rewrite stored markdown content off the retired `view:`
 * URL scheme onto plain box paths.
 *
 *   [label](view:store/x.card)          -> [label](store/x.card)
 *   ![cap](view:store/x.figure.card?p=v) -> ![cap](store/x.figure.card?p=v)
 *   [label](view:store/x.md?zoom)        -> [label](store/x.md)   (?zoom retired)
 *
 * Only link/image *targets* (`](view:…)`) are touched; other query params
 * (`?view=`, figure params) are preserved, the `zoom` flag is dropped. Bare
 * plain paths and external URLs are left byte-identical. See
 * docs/plans/normalize-chat-links.md.
 */

import * as fs from "node:fs/promises";
import { glob } from "glob";

const CONTENT_GLOB_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.pnpm/**",
  "**/.claude/**",
  "**/.callback-box/**",
  "docs/generated/**",
];

// A markdown link/image whose target uses the `view:` scheme:
//   [label](view:URL)   or   ![alt](view:URL)
// Captures the `…](` prefix, the URL after `view:`, and the closing `)`.
const VIEW_TARGET_RE = /(!?\[[^\]]*]\()view:([^\s)]+)(\))/g;

/**
 * Rewrite a single `view:` link/image target: drop the `view:` prefix and the
 * retired `zoom` query flag, keep the path and every other query param.
 */
export function rewriteViewTarget(urlAfterScheme: string): string {
  const qIdx = urlAfterScheme.indexOf("?");
  if (qIdx === -1) return urlAfterScheme;
  const path = urlAfterScheme.slice(0, qIdx);
  const kept = urlAfterScheme
    .slice(qIdx + 1)
    .split("&")
    .filter((part) => part !== "" && part !== "zoom");
  return kept.length > 0 ? `${path}?${kept.join("&")}` : path;
}

/** Rewrite every `view:` link/image target in a document. */
export function rewriteViewLinksInText(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(
    VIEW_TARGET_RE,
    (_match: string, ...groups: [prefix: string, url: string, close: string, ...rest: unknown[]]) => {
      count++;
      const [prefix, url, close] = groups;
      return `${prefix}${rewriteViewTarget(url)}${close}`;
    }
  );
  return { text: out, count };
}

export interface ViewLinkMigrationReport {
  /** Box-relative path → number of `view:` targets rewritten. */
  changed: Array<{ file: string; count: number }>;
  /** Total targets rewritten across all files. */
  total: number;
}

/**
 * Sweep a box's markdown + card content and rewrite `view:` links in place
 * (unless `dryRun`). Returns which files changed and how many targets each had.
 */
export async function migrateBoxViewLinks(
  boxRoot: string,
  { dryRun }: { dryRun: boolean },
): Promise<ViewLinkMigrationReport> {
  const files = await glob(["**/*.md", "**/*.card"], {
    cwd: boxRoot,
    nodir: true,
    absolute: true,
    ignore: CONTENT_GLOB_IGNORE,
  });
  const changed: Array<{ file: string; count: number }> = [];
  let total = 0;
  for (const abs of files.toSorted()) {
    const original = await fs.readFile(abs, "utf8");
    const { text, count } = rewriteViewLinksInText(original);
    if (count === 0) continue;
    total += count;
    changed.push({ file: abs.slice(boxRoot.endsWith("/") ? boxRoot.length : boxRoot.length + 1), count });
    if (!dryRun) await fs.writeFile(abs, text);
  }
  return { changed, total };
}
