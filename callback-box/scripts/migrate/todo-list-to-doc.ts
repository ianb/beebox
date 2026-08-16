/**
 * Pure per-card transform for the `todo-list` → `doc` retirement migration.
 * See `todo-list-to-doc-run.ts` for the CLI driver (tree walk, rename,
 * box-wide ref rewriting, file writes) and its module doc comment for the
 * full description of what this migration does.
 *
 * Kept dependency-free (no fs/git) so the transform itself is directly
 * testable: the caller reads the file and passes in its raw text.
 *
 * Mapping (docs/implemented-plans/todo-annotation.md is the tag vocabulary;
 * src/schemas/todo-list.ts is the shape being retired):
 *  - `name` → `title`.
 *  - `details` (card-level) → the first body paragraph.
 *  - `items[]` → a markdown list, each item wrapped in `{% todo %}…{% /todo %}`;
 *    nesting via `items[].items` becomes indented sub-lists.
 *  - item `status`: pending → no attribute (open); done → `status="done"`;
 *    cancelled → `status="dropped"`; deferred → `status="parked"`.
 *  - item `details` → " — <details>" appended to the wrapped text (inside the
 *    wrapper, so the context stays attached to the todo).
 *  - item `completed` (a done-date the tag deliberately has no attribute for)
 *    → a trailing "(completed <date>)" parenthetical inside the wrapper text.
 *  - item `agent-notes` → an "(agent note: …)" parenthetical, same wrapper.
 *  - card-level `agent-notes` → a trailing `> Agent notes: …` blockquote.
 *  - the universal `title`/`contains`/`contains-evidence`/`todos` fields (see
 *    `src/cards/schema.ts` GLOBAL_CARD_FIELDS) pass through unchanged onto the
 *    new doc card's frontmatter — a `title:` set alongside `name:` wins over
 *    the derived one, since it was an explicit author override.
 *
 * Nothing here is silently dropped: every field outside this list produces a
 * warning (see `docs/migrations.md` — a warning is a prompt to extend the
 * mapping, not to accept the loss).
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Fields recognized on the todo-list card itself (schema fields + the universal ones). */
const CARD_KEYS = new Set([
  "name",
  "details",
  "agent-notes",
  "items",
  "title",
  "contains",
  "contains-evidence",
  "todos",
]);

/** Fields recognized on one item (and, recursively, its nested items). */
const ITEM_KEYS = new Set(["name", "status", "completed", "details", "agent-notes", "items"]);

export interface TodoListConvertResult {
  /** New card content: YAML frontmatter (`title:` + any passed-through global fields) + markdown body. */
  content: string;
  /** Data outside the known mapping — never silently dropped, always reported. */
  warnings: string[];
}

// Dedicated error classes per unmigratable shape (one hardcoded message each —
// code-style bans passing a free-text reason string into a generic custom
// error, since that's functionally a relabeled `new Error(msg)`).

/** The card has no `---`-delimited frontmatter block at all. */
export class MissingFrontmatterError extends Error {
  constructor() {
    super("todo-list card has no frontmatter block");
    this.name = "MissingFrontmatterError";
  }
}

/** The frontmatter block isn't valid YAML. */
export class UnparsableFrontmatterError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("todo-list card frontmatter did not parse as YAML", options);
    this.name = "UnparsableFrontmatterError";
  }
}

/** The frontmatter parsed, but not to a mapping (e.g. a bare scalar or list). */
export class FrontmatterNotMappingError extends Error {
  constructor() {
    super("todo-list card frontmatter is not a mapping");
    this.name = "FrontmatterNotMappingError";
  }
}

/** Neither `title` nor `name` is present, so there's nothing to title the doc card with. */
export class MissingTitleError extends Error {
  constructor() {
    super('todo-list card has neither "title" nor "name" to use as the doc title');
    this.name = "MissingTitleError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function splitCard(raw: string): { fm: string; body: string } | null {
  const m = raw.match(/^---\r?\n([\S\s]*?)\r?\n---\r?\n?([\S\s]*)$/);
  if (m === null) return null;
  return { fm: m[1] ?? "", body: m[2] ?? "" };
}

function checkKeys(params: { obj: Record<string, unknown>; known: Set<string>; where: string; warnings: string[] }): void {
  const { obj, known, where, warnings } = params;
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) warnings.push(`unknown field at ${where}: "${key}"`);
  }
}

function stringAttr(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Map an item's `status` to the tag's attribute string, warning on anything unrecognized. */
function statusAttrFor(params: {
  status: unknown;
  itemName: string;
  warnings: string[];
}): { attr: string; note: string | undefined } {
  const { status, itemName, warnings } = params;
  if (status === undefined || status === "pending") return { attr: "", note: undefined };
  if (status === "done") return { attr: ' status="done"', note: undefined };
  if (status === "cancelled") return { attr: ' status="dropped"', note: undefined };
  if (status === "deferred") return { attr: ' status="parked"', note: undefined };
  warnings.push(`item "${itemName}": unrecognized status "${String(status)}" — left as open, original value kept in text`);
  return { attr: "", note: `original status: ${String(status)}` };
}

/** Render one item (and its nested items) as indented `{% todo %}` list lines. */
function renderItem(params: { raw: unknown; depth: number; path: string; warnings: string[] }): string[] {
  const { raw, depth, path, warnings } = params;
  if (!isRecord(raw)) {
    warnings.push(`${path}: item is not a mapping — skipped, original data: ${JSON.stringify(raw)}`);
    return [];
  }
  checkKeys({ obj: raw, known: ITEM_KEYS, where: path, warnings });

  const name = stringAttr(raw, "name") ?? "(untitled item)";
  if (stringAttr(raw, "name") === undefined) {
    warnings.push(`${path}: item missing a string "name" — used a placeholder`);
  }

  const { attr, note } = statusAttrFor({ status: raw["status"], itemName: name, warnings });
  const details = stringAttr(raw, "details");
  const agentNotes = stringAttr(raw, "agent-notes");
  const completed = stringAttr(raw, "completed");

  let text = details === undefined ? name : `${name} — ${details}`;
  const parens: string[] = [];
  if (agentNotes !== undefined) parens.push(`agent note: ${agentNotes}`);
  if (completed !== undefined) parens.push(`completed ${completed}`);
  if (note !== undefined) parens.push(note);
  if (parens.length > 0) text += ` (${parens.join("; ")})`;

  const indent = "  ".repeat(depth);
  const lines = [`${indent}- {% todo${attr} %}${text}{% /todo %}`];

  const children = raw["items"];
  if (Array.isArray(children)) {
    for (const [i, child] of children.entries()) {
      lines.push(...renderItem({ raw: child, depth: depth + 1, path: `${path} > items[${String(i)}]`, warnings }));
    }
  } else if (children !== undefined) {
    warnings.push(`${path}: "items" is not an array — ignored`);
  }
  return lines;
}

/**
 * Convert one `.todo-list.card`'s raw text into the new `.doc.card` content.
 * Throws one of the dedicated shape-error classes above on a shape too
 * broken to migrate (no frontmatter, unparseable YAML, or no usable title) —
 * the caller reports this as a hard per-file failure (visible, per the
 * harness convention), never a silent skip.
 */
export function convertTodoListCard(raw: string): TodoListConvertResult {
  const split = splitCard(raw);
  if (split === null) throw new MissingFrontmatterError();

  let parsed: unknown;
  try {
    parsed = parseYaml(split.fm);
  } catch (e) {
    throw new UnparsableFrontmatterError({ cause: e });
  }
  if (!isRecord(parsed)) throw new FrontmatterNotMappingError();

  const warnings: string[] = [];
  checkKeys({ obj: parsed, known: CARD_KEYS, where: "<todo-list>", warnings });

  const name = stringAttr(parsed, "name");
  const explicitTitle = stringAttr(parsed, "title");
  const title = explicitTitle ?? name;
  if (title === undefined) throw new MissingTitleError();

  const bodyParts: string[] = [];
  const details = stringAttr(parsed, "details");
  if (details !== undefined) bodyParts.push(details);

  const items = parsed["items"];
  if (Array.isArray(items) && items.length > 0) {
    const lines = items.flatMap((item, i) => renderItem({ raw: item, depth: 0, path: `items[${String(i)}]`, warnings }));
    bodyParts.push(lines.join("\n"));
  } else if (items !== undefined && !Array.isArray(items)) {
    warnings.push('"items" is not an array — ignored');
  }

  const cardAgentNotes = stringAttr(parsed, "agent-notes");
  if (cardAgentNotes !== undefined) bodyParts.push(`> Agent notes: ${cardAgentNotes}`);

  const frontmatter: Record<string, unknown> = { title };
  const contains = stringAttr(parsed, "contains");
  if (contains !== undefined) frontmatter["contains"] = contains;
  const containsEvidence = stringAttr(parsed, "contains-evidence");
  if (containsEvidence !== undefined) frontmatter["contains-evidence"] = containsEvidence;
  if (parsed["todos"] !== undefined) frontmatter["todos"] = parsed["todos"];

  const bodyText = bodyParts.join("\n\n");
  const bodyTail = bodyText === "" ? "" : `${bodyText}${bodyText.endsWith("\n") ? "" : "\n"}`;
  const content = `---\n${stringifyYaml(frontmatter)}---\n${bodyTail}`;

  return { content, warnings };
}
