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
import { parseRef, resolveRefPath } from "../../../shared/ref-path/core.js";
import { titleFromFilename } from "../../../shared/card-name.js";
import { summarize } from "../../loader-registry.js";
import { typeFromFilename } from "../../card-io.js";
import { isCardFile } from "../../../lib/paths/core.js";
import { resolveBoxNamespacePathOnDisk } from "../../../lib/box-namespace-resolve.js";
import { readFrontmatterCached } from "../prominence-cache.js";
import type { ProminenceLevel } from "../../../shared/prominence.js";
import type { PrunedSubtree, SubtreeMemo } from "../prominence-index.js";
import type { CardSchema } from "../../../cards/schema.js";

export interface ResolvedLink {
  /** Box-relative path to the target card. */
  ref: string;
  /** Explicit landmark label; null means "fall back to title". */
  label: string | null;
  /** Display title: the target card's summary title (`title:`, else what its type derives), else derived from the filename. */
  title: string;
  /**
   * The target card's summary line (`FileSummary.detail`): a second line its
   * type writes about itself, such as a loan's holder and due date. Absent
   * when the type writes none or the card could not be read.
   */
  detail?: string;
  /** True if the target file exists on disk. */
  exists: boolean;
  /**
   * Where this link came from — hand-authored, the prominence index, an
   * `expand` glob, or a nested landmark (`"place"`: the row for a place
   * inside this one, which opens its entry point or its landmark card).
   */
  source: "listed" | "derived" | "expand" | "place";
  /**
   * The target's prominence level. Set on a `source: "derived"` or `"place"` link,
   * and on a `"listed"` link whose card is also a derived entry point or primary card.
   * Absent on the place page's "Also here" children, which are ordinary.
   */
  prominence?: ProminenceLevel;
}

export interface ResolveOptions {
  /** Absolute path to the landmark card's directory (the `expand` glob's cwd). */
  landmarkDir: string;
  /**
   * Box-relative path of the landmark card itself — the document every `ref`
   * resolves against (see `src/shared/ref-path/core.ts`).
   */
  landmarkPath: string;
  /** Absolute path to the box root. */
  boxRoot: string;
  /**
   * The box's card schemas (built-in plus box-local), built once per
   * resolution, so a linked card's type can write its title and summary line.
   */
  cardSchemas: Map<string, CardSchema>;
  /**
   * This landmark's pruned subtree (Track B), when the caller wants derived
   * children resolved alongside the hand-listed ones. Omitted by callers
   * that only need identity, or that deliberately skip derivation.
   */
  derived?: PrunedSubtree;
  /** The request's shared pruned-subtree memo; nested-landmark rows read their subtrees through it. */
  subtrees?: SubtreeMemo;
  /**
   * The place page's view: append the "Also here" group of `derived`'s
   * ordinary cards (`resolveAlsoHere`). Ignored without `derived`.
   */
  alsoHere?: boolean;
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
 * the shared ref algebra (`src/shared/ref-path/core.ts`), so a leading-`/` ref means
 * the box root — the form validate and `bbx mv` already understood, which this
 * layer used to mis-resolve to an OS-absolute path. A `?query`/`#fragment`
 * addresses a location within the target: it's kept on the emitted `ref` but
 * dropped before the existence check. A ref that escapes the box resolves to
 * nothing and is reported missing, the same as a broken ref at validate time.
 */
export async function buildLink({ rawRef, label, source, prominence, options }: BuildLinkInput): Promise<ResolvedLink> {
  const parsed = parseRef(rawRef);
  const fallbackTitle = titleFromFilename(parsed.path);
  const resolved = resolveRefPath({
    fromPath: options.landmarkPath,
    ref: parsed.path,
    kind: "card",
  });
  const prominenceField = prominence === undefined ? {} : { prominence };
  if (resolved === null) return { ref: rawRef, label, title: fallbackTitle, exists: false, source, ...prominenceField };
  const suffix =
    (parsed.query === undefined ? "" : `?${parsed.query}`) +
    (parsed.fragment === undefined ? "" : `#${parsed.fragment}`);
  let isFile = false;
  try {
    isFile = (await fs.stat(path.resolve(options.boxRoot, resolved))).isFile();
  } catch (_e) {
    return { ref: resolved + suffix, label, title: fallbackTitle, exists: false, source, ...prominenceField };
  }
  const identity = isFile ? await cardIdentity(resolved, options) : null;
  const detailField = identity?.detail === undefined ? {} : { detail: identity.detail };
  return { ref: resolved + suffix, label, title: identity?.title ?? fallbackTitle, exists: true, source, ...prominenceField, ...detailField };
}

/**
 * The card's title and summary line, from its type's `summarize` over its
 * frontmatter. The title keeps punctuation a slugged filename loses ("Cake
 * carrier (Marisol's)"). Read through the prominence index's per-file parse
 * memo, so a landmark that resolves often re-parses only cards that changed.
 * The cached read is raw YAML, so `type` is injected from the filename as
 * loading a card does (`card-io.ts`); a card with no on-disk `type:` keeps its
 * summary line. Read only inside the box namespace fence, the same fence
 * `expand` applies before it reads a match's frontmatter: nothing may leak
 * from a file outside it. Null when the card cannot be read.
 */
async function cardIdentity(
  boxPath: string,
  { boxRoot, cardSchemas }: Pick<ResolveOptions, "boxRoot" | "cardSchemas">,
): Promise<{ title: string; detail?: string } | null> {
  if (!isCardFile(boxPath)) return null;
  const ns = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: boxPath, mode: "read" });
  if (!ns.ok) return null;
  let frontmatter: Record<string, unknown> | null;
  try {
    frontmatter = (await readFrontmatterCached(path.resolve(boxRoot, boxPath))).fields;
  } catch (e) {
    // Vanished or unreadable between the stat and the read: the filename
    // title still names it.
    console.warn(`[landmark] could not read title of ${boxPath}:`, e);
    return null;
  }
  if (frontmatter === null) return null;
  const type = typeFromFilename(boxPath);
  const fields = type === undefined ? frontmatter : { ...frontmatter, type };
  // An invalid card (one `bbx validate` already reports) keeps the base
  // summary without `summarize` warning about it on every place-page load.
  // A written `type:` that disagrees with the filename is invalid too: the
  // card loader rejects it, so the tile must not summarize it as the
  // filename's type.
  const declared = frontmatter["type"];
  const typeMismatch = declared !== undefined && declared !== type;
  const schema = type === undefined ? undefined : cardSchemas.get(type);
  const valid = !typeMismatch && (schema?.summarize === undefined || schema.frontmatterSchema.safeParse(fields).success);
  const summary = summarize({ path: boxPath, fields, ...(type === undefined ? {} : { type }) }, valid ? cardSchemas : new Map());
  return summary.detail === undefined ? { title: summary.title } : { title: summary.title, detail: summary.detail };
}
