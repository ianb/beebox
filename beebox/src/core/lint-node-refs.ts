/**
 * Box-aware integrity check for cross-card concept-map node references. Two
 * courseware card types name concept-map nodes by their `id`, and those ids must
 * exist in the course's concept-map:
 *
 *   - **progress** — `entries[].node`
 *   - **lesson-plan** — `segments[].concepts[]`
 *
 * This is genuinely cross-card, so it can't live on a self-contained schema
 * `validate` hook; and it's type-specific, so it doesn't belong in the generic
 * ref-existence walk. `card-lint.ts` invokes the right adapter by type.
 *
 * The two types resolve the concept-map DIFFERENTLY:
 *   - progress walks its `course` ref → the course's `concept-map` ref;
 *   - a lesson-plan is co-located with the map in the course attach scope, so it
 *     resolves the **sibling `*.concept-map.card`** in its own directory — no
 *     back-ref that silently no-ops when absent.
 *
 * Each adapter produces a flat list of `{ id, path }` node references — `path`
 * locates the reference (`entries[3].node`, `segments[2].concepts[0]`) so the
 * warning names exactly where the bad id is — and `checkNodeRefs` warns on each
 * id the resolved map doesn't define. If the map doesn't resolve, both stay
 * silent (the generic broken-ref walk already reports the missing link). The
 * lesson-plan adapter additionally emits the self-contained deferral warning (a
 * `material` segment with neither a card nor `status: planned`).
 *
 * Cards' frontmatter YAML is read directly (not via the schema modules) to keep
 * the lint layer decoupled from specific card types.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { splitCardContent, type LintIssue } from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { resolveContainedRef } from "./ref-exists.js";
import { realpathContained } from "../lib/box-containment.js";
import { isRecord } from "./card-io.js";

export interface NodeRefLintInput {
  /** Absolute path of the card being linted. */
  path: string;
  /** Its parsed frontmatter fields. */
  fields: Record<string, unknown>;
  /** Box root, for resolving box-root-absolute (`/…`) refs. */
  boxRoot: string;
}

/** A concept-map node reference found in a card, with where it sits. */
interface NodeRef {
  id: string;
  /** Locator into the card, e.g. `entries[3].node` or `segments[2].concepts[0]`. */
  path: string;
}

/**
 * Warn for each progress entry whose `node` is not a concept-map node id. Walks
 * progress → `course` ref → course's `concept-map` ref → node ids. Silent if any
 * hop is missing/unreadable, or there are no entries.
 */
export async function lintProgressNodeRefs(input: NodeRefLintInput): Promise<LintIssue[]> {
  const { path, fields, boxRoot } = input;
  const refs = progressNodeRefs(fields["entries"]);
  if (refs.length === 0) return [];

  const nodeIds = await conceptMapViaCourse({ fromPath: path, courseRef: refValue(fields["course"]), boxRoot });
  if (nodeIds === null) return [];
  return checkNodeRefs({ nodeIds, refs });
}

/**
 * Warn for a lesson-plan's node and deferral issues: each `segments[].concepts[]`
 * id absent from the sibling concept-map, plus each `material` segment that has
 * neither a `material` ref nor `status: planned` (deferral made visible). The
 * deferral check is self-contained; the node check resolves the sibling map and
 * stays silent if it's missing.
 */
export async function lintLessonPlanNodeRefs(input: NodeRefLintInput): Promise<LintIssue[]> {
  const { path, fields } = input;
  const segments = Array.isArray(fields["segments"]) ? fields["segments"] : [];
  const issues = lessonPlanDeferralWarnings(segments);

  const refs = lessonPlanNodeRefs(segments);
  if (refs.length > 0) {
    const nodeIds = await conceptMapViaSibling(path);
    if (nodeIds !== null) issues.push(...checkNodeRefs({ nodeIds, refs }));
  }
  return issues;
}

/** Warn on each node ref whose `id` the resolved concept-map doesn't define. */
function checkNodeRefs(input: { nodeIds: Set<string>; refs: NodeRef[] }): LintIssue[] {
  const { nodeIds, refs } = input;
  const issues: LintIssue[] = [];
  for (const { id, path } of refs) {
    if (!nodeIds.has(id)) {
      issues.push({
        type: "reference",
        severity: "warning",
        message: `${path} references concept-map node "${id}", which the course's concept-map does not define`,
      });
    }
  }
  return issues;
}

/** Resolve a course-ref'd concept-map's node ids: card → `course` → its `concept-map`. */
async function conceptMapViaCourse(input: {
  fromPath: string;
  courseRef: string | null;
  boxRoot: string;
}): Promise<Set<string> | null> {
  const { fromPath, courseRef, boxRoot } = input;
  if (courseRef === null) return null;
  const containedCourse = resolveContainedRef({ ref: courseRef, fromPath, boxRoot });
  if (containedCourse === null) {
    console.warn(`conceptMapViaCourse: course ref "${courseRef}" in ${fromPath} escapes the box`);
    return null;
  }
  const safeCourse = await realpathContained(boxRoot, containedCourse);
  if (safeCourse === null) {
    console.warn(`conceptMapViaCourse: course ref "${courseRef}" in ${fromPath} resolves outside the box via symlink`);
    return null;
  }
  const coursePath = join(boxRoot, safeCourse);
  const courseFields = await readCardYaml(coursePath);
  if (courseFields === null) return null;

  const mapRef = refValue(courseFields["concept-map"]);
  if (mapRef === null) return null;
  const containedMap = resolveContainedRef({ ref: mapRef, fromPath: coursePath, boxRoot });
  if (containedMap === null) {
    console.warn(`conceptMapViaCourse: concept-map ref "${mapRef}" in ${coursePath} escapes the box`);
    return null;
  }
  const safeMap = await realpathContained(boxRoot, containedMap);
  if (safeMap === null) {
    console.warn(`conceptMapViaCourse: concept-map ref "${mapRef}" in ${coursePath} resolves outside the box via symlink`);
    return null;
  }
  const mapPath = join(boxRoot, safeMap);
  const mapFields = await readCardYaml(mapPath);
  if (mapFields === null) return null;

  return conceptNodeIds(mapFields["concepts"]);
}

/** Resolve the sibling concept-map's node ids: the `*.concept-map.card` in the card's own dir. */
async function conceptMapViaSibling(fromPath: string): Promise<Set<string> | null> {
  const dir = dirname(fromPath);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (_e) {
    return null;
  }
  const mapFile = entries.find(f => f.endsWith(".concept-map.card"));
  if (mapFile === undefined) return null;
  const mapFields = await readCardYaml(join(dir, mapFile));
  if (mapFields === null) return null;
  return conceptNodeIds(mapFields["concepts"]);
}

/** Node refs from a progress card's `entries`: `entries[N].node`. */
function progressNodeRefs(entries: unknown): NodeRef[] {
  if (!Array.isArray(entries)) return [];
  const refs: NodeRef[] = [];
  for (const [i, entry] of entries.entries()) {
    if (!isRecord(entry)) continue;
    const node = entry["node"];
    if (typeof node === "string") refs.push({ id: node, path: `entries[${i}].node` });
  }
  return refs;
}

/** Node refs from a lesson-plan's `segments[].concepts[]`: `segments[N].concepts[M]`. */
function lessonPlanNodeRefs(segments: unknown[]): NodeRef[] {
  const refs: NodeRef[] = [];
  for (const [i, segment] of segments.entries()) {
    if (!isRecord(segment)) continue;
    const concepts = segment["concepts"];
    if (!Array.isArray(concepts)) continue;
    for (const [j, concept] of concepts.entries()) {
      if (typeof concept === "string") refs.push({ id: concept, path: `segments[${i}].concepts[${j}]` });
    }
  }
  return refs;
}

/** A `material` segment with no `material` ref and not `status: planned` → deferral warning. */
function lessonPlanDeferralWarnings(segments: unknown[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const [i, segment] of segments.entries()) {
    if (!isRecord(segment)) continue;
    if (segment["mode"] !== "material") continue;
    if (refValue(segment["material"]) !== null) continue;
    if (segment["status"] === "planned") continue;
    issues.push({
      type: "reference",
      severity: "warning",
      message: `segments[${i}]: material segment with no material card — ref a card or mark it 'status: planned'`,
    });
  }
  return issues;
}

/** The `{ ref: "…" }` string of a field value, or null. */
function refValue(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const ref = value["ref"];
  return typeof ref === "string" ? ref : null;
}

/** The node ids declared in a concept-map's `concepts` array. */
function conceptNodeIds(concepts: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(concepts)) return ids;
  for (const node of concepts) {
    if (!isRecord(node)) continue;
    const id = node["id"];
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
  if (!isRecord(fm)) return null;
  return fm;
}
