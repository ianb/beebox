/**
 * The contents menu's decisions, kept apart from the DOM: which headings a
 * card's contents list holds, when a document is long enough to get one, and
 * which section the reader is in.
 */

import Markdoc, { type RenderableTreeNode } from "@markdoc/markdoc";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { Tag } = Markdoc;

/** One heading of the card's document, as the Markdown renderer emitted it. */
export interface OutlineEntry {
  id: string;
  /** 1–6, from the heading tag. */
  level: number;
  text: string;
}

const HEADING_TAG = /^h([1-6])$/;

/**
 * The headings of a transformed Markdoc tree, in document order: each
 * `h1`–`h6` tag with an id (`makeHeadingNode` gives every heading one), with
 * the text under it.
 */
export function outlineEntries(tree: RenderableTreeNode | readonly RenderableTreeNode[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const visit = (node: RenderableTreeNode | readonly RenderableTreeNode[]): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!Tag.isTag(node)) return;
    const level = HEADING_TAG.exec(node.name)?.[1];
    const id: unknown = node.attributes["id"];
    if (level !== undefined && typeof id === "string") {
      entries.push({ id, level: Number(level), text: textOf(node.children) });
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(tree);
  return entries;
}

function textOf(nodes: readonly RenderableTreeNode[]): string {
  return nodes.map((node) => {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return textOf(node);
    return Tag.isTag(node) ? textOf(node.children) : "";
  }).join("");
}

/** Same headings in the same order. */
export function sameEntries(a: readonly OutlineEntry[], b: readonly OutlineEntry[]): boolean {
  return a.length === b.length && a.every((entry, i) => {
    const other = b.at(i);
    return other !== undefined && entry.id === other.id && entry.level === other.level && entry.text === other.text;
  });
}

/** An entry with its indent: 0 for the shallowest level the document uses. */
export interface OutlineItem extends OutlineEntry {
  depth: number;
}

/**
 * Fewer headings than this and the document is short enough to scroll; the
 * menu stays out of the way.
 */
const MIN_OUTLINE_ENTRIES = 4;

/** Deeper headings than this are detail, not structure. */
const MAX_OUTLINE_LEVEL = 3;

/** The contents list, or `null` when the document gets no menu. */
export function buildOutline(entries: readonly OutlineEntry[]): OutlineItem[] | null {
  const kept = entries.filter((e) => e.level <= MAX_OUTLINE_LEVEL && e.text.trim() !== "");
  if (kept.length < MIN_OUTLINE_ENTRIES) return null;
  const top = Math.min(...kept.map((e) => e.level));
  return kept.map((e) => ({ ...e, text: e.text.trim(), depth: e.level - top }));
}

/**
 * The section the reader is in: the last heading at or above `line` (the
 * scroller's top plus a little), or `null` above the first heading.
 * `tops` are heading tops in document order, in the same coordinates as `line`.
 */
export function currentSection(tops: readonly { id: string; top: number }[], line: number): string | null {
  let current: string | null = null;
  for (const { id, top } of tops) {
    if (top > line) break;
    current = id;
  }
  return current;
}
