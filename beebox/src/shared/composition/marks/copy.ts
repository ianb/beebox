/**
 * What Copy puts on the clipboard (`plan:composition-copy-and-accept-all`,
 * Track 2). The publishing copy is the piece as it would be published: the
 * agent's words and quoted sources as plain text. It exists only when no gap,
 * note, or check is open; otherwise it lists those blockers. The agent's
 * words never block (boxholder decision, 2026-11-16). The draft copy keeps
 * every open mark, labelled, for another reader.
 */
import { scanMarks, type MarkKind } from "./scan.js";
import { compositionPlainText, normalizeComposition, type PlainTag } from "./text.js";

export type BlockerKind = "gap" | "note" | "check";

/** An open mark, by its place among the composition's open marks; the editor finds it by the same count. */
export interface OpenMark {
  kind: Exclude<MarkKind, "source">;
  /** 0-based position among the open marks, in text order. */
  index: number;
  /** The mark's words, whitespace collapsed; empty for a self-closing gap. */
  words: string;
  /** A check's reason. */
  note: string | null;
}

export type PublishingCopy =
  | { status: "ready"; text: string }
  | { status: "blocked"; blockers: (OpenMark & { kind: BlockerKind })[] }
  | { status: "malformed" };

const BLOCKERS: ReadonlySet<string> = new Set<BlockerKind>(["gap", "note", "check"]);

function isBlocker(mark: OpenMark): mark is OpenMark & { kind: BlockerKind } {
  return BLOCKERS.has(mark.kind);
}

/** The open marks in text order, or `null` when the text is malformed. Offsets are the normalized text's, which the editor shows. */
export function openMarks(text: string): OpenMark[] | null {
  const normalized = normalizeComposition(text);
  const scan = scanMarks(normalized);
  if (scan.malformed) return null;
  const marks: OpenMark[] = [];
  for (const mark of scan.marks) {
    if (mark.kind === "source") continue;
    const words = normalized.slice(mark.openTo, mark.closeFrom).replaceAll(/\s+/g, " ").trim();
    marks.push({ kind: mark.kind, index: marks.length, words, note: mark.note });
  }
  return marks;
}

export function publishingCopy(text: string): PublishingCopy {
  const marks = openMarks(text);
  if (marks === null) return { status: "malformed" };
  const blockers = marks.filter(isBlocker);
  if (blockers.length > 0) return { status: "blocked", blockers };
  // Only joiners and sources are left: both drop their tags and keep their words.
  return { status: "ready", text: compositionPlainText(text, { mark: () => "" }) };
}

const DRAFT_LABELS: Record<string, string> = { joiner: "agent", gap: "gap", note: "note", check: "check" };

function draftMark(tag: PlainTag): string {
  if (tag.name === "source") return "";
  const label = DRAFT_LABELS[tag.kind ?? ""] ?? "mark";
  if (tag.selfClosing) return `[${label}]`;
  if (!tag.closing) return `[${label}: `;
  return tag.kind === "check" && tag.note !== null && tag.note !== "" ? ` (why: ${tag.note})]` : "]";
}

/** Every open mark labelled: `[agent: …]`, `[check: … (why: …)]`, `[gap: …]`, `[note: …]`. */
export function draftCopy(text: string): string {
  return compositionPlainText(text, { mark: draftMark });
}
