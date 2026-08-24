/**
 * The todo collector (`docs/implemented-plans/todo-annotation.md`, Track 3): glob every
 * card in a box, parse each body once, and merge the two capture forms
 * (`{% todo %}` tags via `collect-body.ts`; frontmatter `todos:` entries,
 * already Zod-validated at load) into one deterministically ordered list.
 *
 * Read/query only — mutation is editing the card (normal card-edit path,
 * per the plan). `cb todos` (`src/cli/commands/todos.ts`) is a thin
 * presentation layer over this.
 *
 * A card that fails to load (invalid frontmatter, unreadable file) or whose
 * body fails Markdoc parse/validate on a todo-relevant tag is reported as a
 * visible `TodoCollectionIssue`, never silently skipped — the plan's answer
 * to the "todo graveyard" failure mode every comparable inline system falls
 * into. Duplicate `id`s box-wide are likewise reported as issues; the
 * collection still returns every todo (duplication doesn't hide anything).
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { splitCardContent } from "../../cards/index.js";
import { parseCardText, typeFromFilename, type LoadCardContext } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { getBoxTime } from "../../lib/time.js";
import { loadBoxTimezone } from "../box/config.js";
import { deriveTodoPlateState, TodosFieldSchema, type TodoPlateContext } from "../../shared/todo-model.js";
import { collectBodyTodos } from "./collect-body.js";
import { errorMessage } from "../../lib/error-guards.js";
import type {
  CollectedTodo,
  CollectTodosOptions,
  TodoCollectionIssue,
  TodoCollectionResult,
  TodoLocator,
} from "./collect-types.js";
import { formatTodoLocation, plateInputFor } from "./collect-types.js";

// Same non-content dirs `list-cards.ts` prunes; kept local rather than
// importing that module's private constant (a one-line list, not worth a
// cross-module dependency for).
const CARD_GLOB_IGNORE = ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"];

/**
 * A `glob`/`cardPath` input that could resolve outside the box root: an
 * OS-absolute pattern (the `glob` package honors these verbatim, ignoring
 * `cwd`) or any `..` path segment. Thrown by the collector — every consumer
 * (`todos.list`'s zod input, `cb todos --glob`) shares this one guard rather
 * than each re-deriving it, so the box-root boundary can't drift out of sync
 * between them.
 */
class UnsafeTodoGlobError extends Error {
  constructor(pattern: string) {
    super(`glob must stay within the box root — no absolute paths or ".." segments (got "${pattern}")`);
    this.name = "UnsafeTodoGlobError";
  }
}

/** True when `pattern` is an OS-absolute path or contains a `..` segment — see {@link UnsafeTodoGlobError}. */
export function isUnsafeGlobPattern(pattern: string): boolean {
  return path.isAbsolute(pattern) || pattern.split("/").includes("..");
}

/** Throws {@link UnsafeTodoGlobError} if `pattern` could resolve outside the box root. */
export function assertSafeGlobPattern(pattern: string): void {
  if (isUnsafeGlobPattern(pattern)) throw new UnsafeTodoGlobError(pattern);
}

/**
 * Every card path a todo scan would visit, sorted, guaranteed inside the box.
 * Shared with the nav-badge counter (`count.ts`) so both walk exactly the same
 * card set under exactly the same containment rules.
 */
export async function listTodoCardPaths(boxRoot: string, pattern: string): Promise<string[]> {
  assertSafeGlobPattern(pattern);
  const boxRootResolved = path.resolve(boxRoot);
  const globbed = await glob(pattern, {
    cwd: boxRoot,
    nodir: true,
    absolute: true,
    ignore: CARD_GLOB_IGNORE,
  });
  // A todo-view's glob is a *scope*, not a file filter: the box-wide plate
  // ships `glob: "**"` and project plates use bare directory globs
  // (`store/projects/foo/**`), so those patterns match every file under the
  // scope — briefing.md, config JSON, generated docs. Only card files are todo
  // candidates; scope every pattern to them here, centrally, exactly as the
  // absent-glob default `**/*.card` does. Without this, each non-card match
  // fell through to classifyCardType and rendered in the todo view as a
  // "card couldn't be read" issue — a box-wide plate dumped every non-card
  // file in the box as an error.
  const rawAbsPaths = globbed.filter((absPath) => absPath.endsWith(".card"));
  // Defense-in-depth: even a pattern that passed `assertSafeGlobPattern`
  // shouldn't be able to produce a match outside the box root (e.g. a
  // symlinked card directory) — verify containment on the resolved paths
  // before anything is read, rather than trusting the pattern alone.
  const absPaths = rawAbsPaths.filter((absPath) => {
    const resolved = path.resolve(absPath);
    const rel = path.relative(boxRootResolved, resolved);
    const contained = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    if (!contained) {
      console.warn(`[todo-collector] dropping out-of-box glob match for pattern "${pattern}": ${absPath}`);
    }
    return contained;
  });
  return absPaths.toSorted();
}

/** The per-card load + plate-state context both scans need. */
export async function buildTodoScanContext(boxRoot: string): Promise<{ ctx: LoadCardContext; plateCtx: TodoPlateContext }> {
  const schemas = await createCardSchemaMap(boxRoot);
  return {
    ctx: { cardSchemas: schemas },
    plateCtx: {
      now: getBoxTime(boxRoot),
      timeZone: (await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

export async function collectTodos(boxRoot: string, options?: CollectTodosOptions): Promise<TodoCollectionResult> {
  const pattern = options?.glob ?? "**/*.card";
  const absPaths = await listTodoCardPaths(boxRoot, pattern);
  const { ctx, plateCtx } = await buildTodoScanContext(boxRoot);

  const todos: CollectedTodo[] = [];
  const issues: TodoCollectionIssue[] = [];

  for (const absPath of absPaths) {
    const relPath = path.relative(boxRoot, absPath);
    await collectOneCard({ absPath, relPath, ctx, plateCtx, todos, issues });
  }

  issues.push(...duplicateIdIssues(todos));
  todos.sort(compareByLocator);
  issues.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind.localeCompare(b.kind)));
  return { todos, issues };
}

async function collectOneCard(input: {
  absPath: string;
  relPath: string;
  ctx: LoadCardContext;
  plateCtx: TodoPlateContext;
  todos: CollectedTodo[];
  issues: TodoCollectionIssue[];
}): Promise<void> {
  const { absPath, relPath, ctx, issues } = input;
  // Classify before reading, so a card that is *both* unknown-type and
  // unreadable reports the unknown type — the more actionable of the two, and
  // the issue this reported before the read was hoisted out.
  const classified = classifyCardType({ absPath, relPath, ctx });
  if (!classified.ok) {
    issues.push(classified.issue);
    return;
  }
  let content: string;
  try {
    content = await readFile(absPath, "utf8");
  } catch (e) {
    issues.push({ kind: "load", path: relPath, message: errorMessage(e) });
    return;
  }
  collectCardTodos({ ...input, content });
}

/**
 * The card's type, or the issue for a card whose type can't be schema-loaded
 * at all (an unparseable filename, or a `type` with no registered schema — a
 * deleted box-local schema, a typo'd filename). Such a card is reported as
 * visible-invalid rather than silently skipped: "any globbed card that cannot
 * be schema-loaded is reported" is what the plan's visible-invalid guarantee
 * means (`docs/implemented-plans/todo-annotation.md`, Failure modes table) —
 * a schema that goes missing shouldn't be able to hide a card's todos forever
 * with zero signal.
 */
function classifyCardType(input: {
  absPath: string;
  relPath: string;
  ctx: LoadCardContext;
}): { ok: true; type: string } | { ok: false; issue: TodoCollectionIssue } {
  const { absPath, relPath, ctx } = input;
  const type = typeFromFilename(absPath);
  if (type !== undefined && ctx.cardSchemas.has(type)) return { ok: true, type };
  return {
    ok: false,
    issue: {
      kind: "unknown-type",
      path: relPath,
      message:
        type === undefined
          ? "card filename doesn't match the Name.<type>.card pattern"
          : `no registered schema for card type "${type}"`,
    },
  };
}

/**
 * Extract one already-read card's todos (both capture forms) into `todos`,
 * recording anything that blocked extraction in `issues`. Split out from
 * {@link collectOneCard} so the nav-badge counter (`count.ts`) can feed it
 * text it read in parallel rather than re-implementing todo semantics.
 */
export function collectCardTodos(input: {
  absPath: string;
  relPath: string;
  content: string;
  ctx: LoadCardContext;
  plateCtx: TodoPlateContext;
  todos: CollectedTodo[];
  issues: TodoCollectionIssue[];
}): void {
  const { absPath, relPath, content, ctx, plateCtx, todos, issues } = input;
  const classified = classifyCardType({ absPath, relPath, ctx });
  if (!classified.ok) {
    issues.push(classified.issue);
    return;
  }
  const type = classified.type;

  let parsed: ReturnType<typeof parseCardText>;
  try {
    parsed = parseCardText(content, { source: absPath, schemas: ctx.cardSchemas, type });
  } catch (e) {
    issues.push({ kind: "load", path: relPath, message: errorMessage(e) });
    return;
  }

  const fmParse = TodosFieldSchema.safeParse(parsed.fields["todos"]);
  const fmEntries = fmParse.success && fmParse.data !== undefined ? fmParse.data : [];
  let index = 0;
  for (const entry of fmEntries) {
    const status = entry.status ?? "open";
    const seeAlso = (entry["see-also"] ?? []).map((sa) => ({ ref: sa.ref, href: sa.href, note: sa.note }));
    todos.push({
      path: relPath,
      locator: { kind: "frontmatter", index },
      id: entry.id,
      text: entry.text,
      status,
      assigned: entry.assigned,
      by: entry.by,
      created: entry.created,
      due: entry.due,
      start: entry.start,
      seeAlso,
      plateState: deriveTodoPlateState(plateInputFor({ status, start: entry.start, due: entry.due }), plateCtx),
    });
    index++;
  }

  const lineOffset = splitCardContent(content).lineOffset;
  const bodyResult = collectBodyTodos({ path: relPath, bodyText: parsed.rawBody, lineOffset, ctx: plateCtx });
  if (bodyResult.ok) {
    todos.push(...bodyResult.todos);
  } else {
    issues.push({ kind: bodyResult.kind, path: relPath, message: bodyResult.message });
  }
}

function duplicateIdIssues(todos: CollectedTodo[]): TodoCollectionIssue[] {
  const byId = new Map<string, string[]>();
  for (const todo of todos) {
    if (todo.id === undefined) continue;
    const locations = byId.get(todo.id) ?? [];
    locations.push(formatTodoLocation(todo));
    byId.set(todo.id, locations);
  }
  const issues: TodoCollectionIssue[] = [];
  for (const [id, locations] of byId) {
    if (locations.length < 2) continue;
    const sorted = locations.toSorted();
    issues.push({
      kind: "duplicate-id",
      path: sorted.join(", "),
      message: `duplicate todo id "${id}" used at: ${sorted.join(", ")}`,
    });
  }
  return issues.toSorted((a, b) => a.path.localeCompare(b.path));
}

function compareByLocator(a: CollectedTodo, b: CollectedTodo): number {
  if (a.path !== b.path) return a.path.localeCompare(b.path);
  return compareLocator(a.locator, b.locator);
}

/** Body locators sort before frontmatter locators on the same card — an arbitrary but deterministic tie-break (the plan doesn't order the two kinds against each other). */
function compareLocator(a: TodoLocator, b: TodoLocator): number {
  if (a.kind !== b.kind) return a.kind === "body" ? -1 : 1;
  if (a.kind === "body" && b.kind === "body") return a.line - b.line;
  if (a.kind === "frontmatter" && b.kind === "frontmatter") return a.index - b.index;
  return 0;
}
