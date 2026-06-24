/**
 * Box-aware integrity check for progress cards: every progress entry names a
 * concept-map node by its `id`, and those ids must exist in the course's
 * concept-map. This is genuinely cross-card (progress → course → concept-map),
 * so it can't live on the self-contained schema `validate` hook; and it's
 * type-specific, so it doesn't belong in the generic ref-existence walk. It gets
 * its own module, which `card-lint.ts` invokes only for `progress` cards.
 *
 * It reads the referenced cards' frontmatter YAML directly (rather than
 * importing the schema modules) to keep the lint layer decoupled from specific
 * card types. If the course/concept-map chain doesn't resolve, it stays silent —
 * the generic broken-ref walk already reports the missing link.
 */

import { readFile } from "node:fs/promises";
import { splitCardContent, type LintIssue } from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { resolveRefToPath } from "./ref-exists.js";

export interface ProgressNodeLintInput {
  /** Absolute path of the progress card. */
  path: string;
  /** Its parsed frontmatter fields. */
  fields: Record<string, unknown>;
  /** Box root, for resolving box-root-absolute (`/…`) refs. */
  boxRoot: string;
}

/**
 * Warn for each progress entry whose `node` is not a concept-map node id. Walks
 * progress → `course` ref → course's `concept-map` ref → node ids. Returns []
 * (silently) if any hop is missing/unreadable.
 */
export async function lintProgressNodeRefs(input: ProgressNodeLintInput): Promise<LintIssue[]> {
  const { path, fields, boxRoot } = input;
  const entryNodes = progressEntryNodes(fields["entries"]);
  if (entryNodes.length === 0) return [];

  const courseRef = refValue(fields["course"]);
  if (courseRef === null) return [];
  const coursePath = resolveRefToPath({ ref: courseRef, fromPath: path, boxRoot });
  const courseFields = await readCardYaml(coursePath);
  if (courseFields === null) return [];

  const mapRef = refValue(courseFields["concept-map"]);
  if (mapRef === null) return [];
  const mapPath = resolveRefToPath({ ref: mapRef, fromPath: coursePath, boxRoot });
  const mapFields = await readCardYaml(mapPath);
  if (mapFields === null) return [];

  const nodeIds = conceptNodeIds(mapFields["concepts"]);
  const issues: LintIssue[] = [];
  for (const node of entryNodes) {
    if (!nodeIds.has(node)) {
      issues.push({
        type: "reference",
        severity: "warning",
        message: `progress entry references concept-map node "${node}", which the course's concept-map does not define`,
      });
    }
  }
  return issues;
}

/** The `{ ref: "…" }` string of a field value, or null. */
function refValue(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const ref = (value as Record<string, unknown>)["ref"];
  return typeof ref === "string" ? ref : null;
}

/** The node ids referenced by a progress card's `entries`. */
function progressEntryNodes(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  const nodes: string[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const node = (entry as Record<string, unknown>)["node"];
    if (typeof node === "string") nodes.push(node);
  }
  return nodes;
}

/** The node ids declared in a concept-map's `concepts` array. */
function conceptNodeIds(concepts: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(concepts)) return ids;
  for (const node of concepts) {
    if (node === null || typeof node !== "object") continue;
    const id = (node as Record<string, unknown>)["id"];
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/** Read + YAML-parse a card's frontmatter, or null if missing/malformed. */
async function readCardYaml(absPath: string): Promise<Record<string, unknown> | null> {
  let content: string;
  try {
    content = await readFile(absPath, "utf8");
  } catch (_e) {
    return null;
  }
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    return null;
  }
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return null;
  return fm as Record<string, unknown>;
}
