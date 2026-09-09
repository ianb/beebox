/**
 * Resolve one ref into a `ResolvedLink` the client can follow — the one
 * shared building block behind every source a landmark's flat link list can
 * carry (`resolve.ts`'s hand-listed `links` and `expand`, `derived-links.ts`'s
 * prominence-index tiers). Split out so `resolve.ts` and `derived-links.ts`
 * can both use it without importing each other (see `derived-links.ts`'s
 * header for why that matters).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseRef, resolveRefPath } from "../../shared/ref-path.js";
import { titleFromFilename } from "../file-summary.js";
import type { ProminenceLevel } from "../../shared/prominence.js";
import type { PrunedSubtree } from "./prominence-index.js";

export interface ResolvedLink {
  /** Box-relative path to the target card. */
  ref: string;
  /** Explicit landmark label; null means "fall back to title". */
  label: string | null;
  /** Display title for the target (filename-derived for now). */
  title: string;
  /** True if the target file exists on disk. */
  exists: boolean;
  /** Where this link came from — hand-authored, the prominence index, or an `expand` glob. */
  source: "listed" | "derived" | "expand";
  /** The target's prominence level. Only ever set on a `source: "derived"` link. */
  prominence?: ProminenceLevel;
}

export interface ResolveOptions {
  /** Absolute path to the landmark card's directory (the `expand` glob's cwd). */
  landmarkDir: string;
  /**
   * Box-relative path of the landmark card itself — the document every `ref`
   * resolves against (see `src/shared/ref-path.ts`).
   */
  landmarkPath: string;
  /** Absolute path to the box root. */
  boxRoot: string;
  /**
   * This landmark's pruned subtree (Track B), when the caller wants derived
   * children resolved alongside the hand-listed ones. Omitted by callers
   * that only need identity, or that deliberately skip derivation.
   */
  derived?: PrunedSubtree;
}

export interface BuildLinkInput {
  rawRef: string;
  label: string | null;
  source: ResolvedLink["source"];
  prominence?: ProminenceLevel;
  options: ResolveOptions;
}

/**
 * Resolve one `ref` into a link the client can follow. Resolution goes through
 * the shared ref algebra (`src/shared/ref-path.ts`), so a leading-`/` ref means
 * the box root — the form validate and `bbx mv` already understood, which this
 * layer used to mis-resolve to an OS-absolute path. A `?query`/`#fragment`
 * addresses a location within the target: it's kept on the emitted `ref` but
 * dropped before the existence check. A ref that escapes the box resolves to
 * nothing and is reported missing, the same as a broken ref at validate time.
 */
export async function buildLink({ rawRef, label, source, prominence, options }: BuildLinkInput): Promise<ResolvedLink> {
  const parsed = parseRef(rawRef);
  const title = titleFromFilename(parsed.path);
  const resolved = resolveRefPath({
    fromPath: options.landmarkPath,
    ref: parsed.path,
    kind: "card",
  });
  const prominenceField = prominence === undefined ? {} : { prominence };
  if (resolved === null) return { ref: rawRef, label, title, exists: false, source, ...prominenceField };
  const suffix =
    (parsed.query === undefined ? "" : `?${parsed.query}`) +
    (parsed.fragment === undefined ? "" : `#${parsed.fragment}`);
  let exists = false;
  try {
    await fs.stat(path.resolve(options.boxRoot, resolved));
    exists = true;
  } catch (_e) {
    exists = false;
  }
  return { ref: resolved + suffix, label, title, exists, source, ...prominenceField };
}
