/**
 * Pure logic for `TodoViewCard` (`docs/plans/todo-collection.md`, Track 4),
 * split out of the `.tsx` component so it's doctestable without a React
 * render harness (this repo has no component-render test setup — see
 * sibling pure-logic modules like `chat/scroll-reconcile.ts`).
 *
 * `collections.query` hands back a FLAT, locator-ordered item list per row,
 * each item naming its parent and the headings above it. Everything here
 * turns that back into the shape a reader sees: a tree, sections, a dated
 * strip across the whole result, and the "5 of 7" a section header shows.
 */

// Raw relative (not `@shared/…`): loaded outside Vite by the tap/tsx doctest
// runner (root tsconfig, no @shared resolution) — see OUTSIDE_VITE_SHARED_RAW
// in src/frontend/eslint.config.ts.
import { isTodoStatus, resolveStartEpoch } from "../../../shared/todo-model.js";
import type { TodoStatus } from "../../../shared/todo-model.js";
// Type-only, so nothing of the tRPC client is loaded when the doctest runner
// imports this module. The router's OUTPUT type rather than the core
// `CollectionResult` on purpose: what reaches the browser has been through
// JSON, where an `x: string | undefined` field becomes `x?: string`.
import type { RouterOutput } from "../lib/trpc";
import type { TodoLocator } from "@core/todo/collect-types";

export type TodoResult = RouterOutput["collections"]["query"];
export type TodoReduction = TodoResult["reduction"];
export type TodoRow = TodoResult["groups"][number]["rows"][number];
/** One item as a row carries it: the derived todo plus whether the query matched it. */
export type TodoRowItem = TodoRow["items"][number];

/**
 * The `status` filter a `todo-view` card's frontmatter resolves to. An
 * explicit `status:` list wins; an omitted one defaults to `["open",
 * "parked"]` — every plate-state group an `open` todo can land in
 * (escalated/on-plate/quiet) PLUS `parked`, so the parked group is actually
 * reachable on the stock plate without the card author having to list
 * `parked` explicitly. Defaulting to `["open"]` alone made the parked
 * section permanently unreachable: `parked` is a STATUS, not a plate-state,
 * so it was never included by that default. `done`/`dropped` stay excluded
 * unless a card explicitly lists them.
 */
export function resolveTodoViewStatusFilter(fm: Record<string, unknown>): TodoStatus[] {
  const value = fm["status"];
  if (Array.isArray(value)) {
    const statuses = value.filter((v): v is TodoStatus => typeof v === "string" && isTodoStatus(v));
    if (statuses.length > 0) return statuses;
  }
  return ["open", "parked"];
}

/**
 * The status filter the query actually runs with. Done and dropped are hidden
 * by default and counted; the "show finished" control widens the filter
 * rather than filtering client-side, so the reduction and the list keep
 * agreeing about what is in scope.
 */
export function statusFilterWithFinished(base: TodoStatus[], showFinished: boolean): TodoStatus[] {
  if (!showFinished) return base;
  const out = [...base];
  for (const status of ["done", "dropped"] as const) {
    if (!out.includes(status)) out.push(status);
  }
  return out;
}

/**
 * The `here` a `todo-view` card asks about: its own DIRECTORY, not its own
 * path. A card path would scope the query to the card itself, which holds no
 * todos; the directory is the place the card is filed under, and is what the
 * old `cardPath`-to-glob rule computed.
 */
export function hereForCard(cardPath: string): string {
  const slash = cardPath.lastIndexOf("/");
  return slash === -1 ? "" : cardPath.slice(0, slash);
}

/** `path:line` for a body todo, `path#todos[i]` for a frontmatter one — the identity `parent` names. */
export function todoKey(item: { path: string; locator: TodoLocator }): string {
  const { path, locator } = item;
  return locator.kind === "body" ? `${path}:${String(locator.line)}` : `${path}#todos[${String(locator.index)}]`;
}

function parentKeyOf(item: { path: string; parent: TodoLocator | null }): string | null {
  return item.parent === null ? null : todoKey({ path: item.path, locator: item.parent });
}

export interface TodoNode {
  item: TodoRowItem;
  children: TodoNode[];
}

/**
 * The flat, locator-ordered item list back into the tree its `parent` links
 * describe. An item whose parent is not in the list (the filter kept the
 * child but the row's ancestor walk did not reach that far) is a root rather
 * than a disappearance.
 */
export function buildTodoTree(items: readonly TodoRowItem[]): TodoNode[] {
  const nodes = new Map<string, TodoNode>();
  for (const item of items) nodes.set(todoKey(item), { item, children: [] });

  const roots: TodoNode[] = [];
  for (const item of items) {
    const node = nodes.get(todoKey(item));
    if (node === undefined) continue;
    const parentKey = parentKeyOf(item);
    const parent = parentKey === null ? undefined : nodes.get(parentKey);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  return roots;
}

export interface TodoSectionBlock {
  /** The full heading path, outermost first. `[]` for items written under no heading. */
  path: string[];
  /** The last segment — what a subhead shows. `null` when there is no heading. */
  label: string | null;
  /** The section's own reduction, from the row. `null` only for the unsectioned block when the row has no matching entry. */
  reduction: TodoReduction | null;
  nodes: TodoNode[];
}

/**
 * A row's items as sections of trees. Items written under no heading come
 * first, without a subhead; the rest follow in the order the row's `sections`
 * give, which is the order the headings appear in the card.
 *
 * Only a ROOT is placed in a section: a nested todo belongs under its parent,
 * whatever heading the parent sat beneath.
 */
export function buildRowSections(row: TodoRow): TodoSectionBlock[] {
  const roots = buildTodoTree(row.items);
  const byKey = new Map<string, TodoNode[]>();
  for (const node of roots) {
    const key = sectionKey(node.item.sectionPath);
    const list = byKey.get(key) ?? [];
    list.push(node);
    byKey.set(key, list);
  }

  const blocks: TodoSectionBlock[] = [];
  const unsectioned = byKey.get(sectionKey([]));
  if (unsectioned !== undefined) {
    blocks.push({ path: [], label: null, reduction: reductionFor(row, []), nodes: unsectioned });
  }
  for (const section of row.sections) {
    if (section.path.length === 0) continue;
    const nodes = byKey.get(sectionKey(section.path));
    if (nodes === undefined) continue;
    blocks.push({
      path: section.path,
      label: section.path[section.path.length - 1] ?? null,
      reduction: section.reduction,
      nodes,
    });
  }
  return blocks;
}

function sectionKey(path: readonly string[]): string {
  return path.join("\u0000");
}

function reductionFor(row: TodoRow, path: string[]): TodoReduction | null {
  const key = sectionKey(path);
  return row.sections.find((section) => sectionKey(section.path) === key)?.reduction ?? null;
}

/**
 * "5 of 7" — how much of a section is finished. `dropped` is left out of both
 * halves: a todo deliberately not being done is not progress, and counting it
 * as either would misstate the section.
 */
export function progressOf(reduction: TodoReduction): { done: number; total: number } {
  return { done: reduction.done, total: reduction.open + reduction.done + reduction.parked };
}

export interface DatedTodo {
  key: string;
  item: TodoRowItem;
  /** The ISO date shown, and which field it came from. */
  date: string;
  kind: "due" | "start";
  cardPath: string;
  cardTitle: string;
}

/**
 * The dated strip: every open matching item in the result that carries a
 * `due` or a `start`, in date order, each naming the card it was written in.
 *
 * `due` wins when both are present — it is the harder of the two dates — and
 * the strip says which one it is showing, so "starts Monday" is not mistaken
 * for a deadline. A `start` is resolved against its `due` first, the same way
 * plate state resolves it.
 */
export function datedTodos(result: TodoResult): DatedTodo[] {
  const seen = new Map<string, DatedTodo>();
  for (const group of result.groups) {
    for (const row of group.rows) {
      for (const item of row.items) {
        if (!item.matching || item.status !== "open") continue;
        const dated = dateOf(item);
        if (dated === null) continue;
        const key = todoKey(item);
        if (seen.has(key)) continue;
        seen.set(key, { key, item, ...dated, cardPath: row.card.path, cardTitle: row.card.title });
      }
    }
  }
  return [...seen.values()].toSorted((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date)));
}

function dateOf(item: TodoRowItem): { date: string; kind: "due" | "start" } | null {
  if (item.due !== undefined) return { date: item.due, kind: "due" };
  if (item.start === undefined) return null;
  const epoch = resolveStartEpoch(item.start, item.due);
  if (epoch === null) return null;
  return { date: new Date(epoch).toISOString().slice(0, 10), kind: "start" };
}

/** How long an annotation may run before the list truncates it behind an expand control. */
const ANNOTATION_CLAMP = 140;

export function needsExpand(annotation: string): boolean {
  return annotation.length > ANNOTATION_CLAMP;
}

export function clampAnnotation(annotation: string): string {
  if (!needsExpand(annotation)) return annotation;
  return `${annotation.slice(0, ANNOTATION_CLAMP).trimEnd()}…`;
}
