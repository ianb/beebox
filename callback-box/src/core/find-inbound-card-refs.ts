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

/**
 * Find every card with at least one incoming reference in one referrer pass.
 * This is the box-wide counterpart to {@link findInboundCardRefs}; it keeps the
 * same canonical token scanner/resolution without rescanning the box per card.
 */
export async function findLinkedCardPaths(params: {
  boxRoot: string;
  cardPaths: string[];
}): Promise<{ linked: Set<string>; errors: string[] }> {
  const boxRoot = path.resolve(params.boxRoot);
  const cardsByTarget = new Map<string, string>();
  const cardsByAttachDir = new Map<string, Set<string>>();
  for (const cardPath of params.cardPaths) {
    const target = path.resolve(boxRoot, cardPath);
    cardsByTarget.set(target, cardPath);
    const attachDir = attachDirFor(target);
    const owners = cardsByAttachDir.get(attachDir) ?? new Set<string>();
    owners.add(cardPath);
    cardsByAttachDir.set(attachDir, owners);
  }
  const referrers = [
    ...(await listBoxCardFiles(boxRoot)),
    ...(await listBoxMarkdownFiles(boxRoot)),
    ...(await listBoxViewFiles(boxRoot)),
  ];
  const ignore = await loadValidationIgnore(boxRoot);
  const linked = new Set<string>();
  const errors: string[] = [];
  const sentinel = path.join(boxRoot, ".callback-box", "linked-card-sentinel");
  for (const referrerPath of referrers) {
    const relReferrer = path.relative(boxRoot, referrerPath);
    if (isTrashedCard(relReferrer) || ignore.isIgnored(referrerPath)) continue;
    const remap: Remap = (resolved) => {
      const cardPaths = linkedCardsForResolvedPath({ resolved, cardsByTarget, cardsByAttachDir, boxRoot });
      const eligible = cardPaths.filter((cardPath) => {
        const target = path.resolve(boxRoot, cardPath);
        const attachDir = attachDirFor(target);
        return referrerPath !== target && !referrerPath.startsWith(attachDir + path.sep);
      });
      for (const cardPath of eligible) linked.add(cardPath);
      return eligible.length === 0 ? null : sentinel;
    };
    try {
      const text = await fs.readFile(referrerPath, "utf-8");
      if (referrerPath.endsWith(".tsx")) {
        rewriteViewRefs({ boxRoot, viewAbsPath: referrerPath, text, remap });
      } else {
        countReferrerRefs({ boxRoot, cardAbsPath: referrerPath, text, remap, skipFencedCode: true });
      }
    } catch (error) {
      errors.push(`${relReferrer}: ${String(error)}`);
      console.warn(`Skipping unreadable referrer while checking linked cards: ${referrerPath}:`, error);
    }
  }
  return { linked, errors };
}

function linkedCardsForResolvedPath(input: {
  resolved: string;
  cardsByTarget: Map<string, string>;
  cardsByAttachDir: Map<string, Set<string>>;
  boxRoot: string;
}): string[] {
  const direct = input.cardsByTarget.get(input.resolved);
  if (direct !== undefined) return [direct];
  let candidate = input.resolved;
  while (candidate.startsWith(input.boxRoot + path.sep)) {
    const attached = input.cardsByAttachDir.get(candidate);
    if (attached !== undefined) return [...attached];
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return [];
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
