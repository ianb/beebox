/**
 * Read-only counterpart to `rewrite-card-refs.ts`: find documents whose refs
 * resolve to a card (or anything in its sibling attach scope).
 *
 * Detection deliberately runs through the rewrite scanner with a sentinel
 * remap. That keeps the recognized syntax and, crucially, relative-ref
 * resolution identical to `cb mv`; this module never grows a second scanner.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { attachDirFor } from "../shared/attach-path.js";
import { listBoxCardFiles, listBoxMarkdownFiles, listBoxViewFiles } from "./list-cards.js";
import { countReferrerRefs, rewriteViewRefs, type Remap } from "./rewrite-card-refs.js";
import { isTrashedCard } from "../lib/paths.js";
import { loadValidationIgnore } from "./validation-ignore.js";

export interface InboundCardRef {
  path: string;
  refs: number;
}

export async function findInboundCardRefs(params: {
  boxRoot: string;
  cardPath: string;
}): Promise<InboundCardRef[]> {
  const boxRoot = path.resolve(params.boxRoot);
  const target = path.resolve(boxRoot, params.cardPath);
  const attachDir = attachDirFor(target);
  const sentinel = path.join(boxRoot, ".callback-box", "inbound-ref-sentinel");
  const remap: Remap = (resolved) => {
    if (resolved === target || resolved === attachDir || resolved.startsWith(attachDir + path.sep)) {
      return sentinel;
    }
    return null;
  };
  const referrers = [
    ...(await listBoxCardFiles(boxRoot)),
    ...(await listBoxMarkdownFiles(boxRoot)),
    ...(await listBoxViewFiles(boxRoot)),
  ];
  const ignore = await loadValidationIgnore(boxRoot);
  const found: InboundCardRef[] = [];
  for (const referrerPath of referrers) {
    const relPath = path.relative(boxRoot, referrerPath);
    if (referrerPath === target || referrerPath.startsWith(attachDir + path.sep)) continue;
    if (isTrashedCard(relPath) || ignore.isIgnored(referrerPath)) continue;
    try {
      const text = await fs.readFile(referrerPath, "utf-8");
      const count = referrerPath.endsWith(".tsx")
        ? rewriteViewRefs({ boxRoot, viewAbsPath: referrerPath, text, remap }).count
        : countReferrerRefs({ boxRoot, cardAbsPath: referrerPath, text, remap, skipFencedCode: true });
      if (count > 0) {
        found.push({ path: relPath, refs: count });
      }
    } catch (error) {
      console.warn(`Skipping unreadable referrer while checking inbound refs: ${referrerPath}:`, error);
    }
  }
  return found.toSorted((a, b) => a.path.localeCompare(b.path));
}
