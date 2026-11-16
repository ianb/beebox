/**
 * The edits behind the composition's resolve actions
 * (`plan:composition-copy-and-accept-all`, Track 1): accept all agent words,
 * keep all checked words, remove all notes, or keep or remove one check or
 * note. The server applies them (`card.resolveComposition`); each is
 * computed and checked here before anything is committed.
 */
import { acceptChanges, scanMarks, wholeMarkRange, type MarkKind, type MarkRange, type TextChange } from "./scan.js";

export type ResolveRequest =
  | { action: "accept-joiners" | "keep-checks" | "remove-notes" }
  /** One mark, by its 0-based place among the open marks (`openMarks` in `copy.ts`). */
  | { action: "keep-check" | "remove-note"; index: number };

export type ResolveEdit =
  | { status: "edit"; text: string }
  /** No mark of that kind (or none at that index). */
  | { status: "nothing" }
  /** The marks are there, but the edit would leave the text malformed, or the mark at the index is another kind. */
  | { status: "refused" };

const KIND: Record<ResolveRequest["action"], MarkKind> = {
  "accept-joiners": "joiner",
  "keep-checks": "check",
  "remove-notes": "note",
  "keep-check": "check",
  "remove-note": "note",
};

function apply(text: string, changes: readonly TextChange[]): string {
  let out = text;
  for (const change of changes.toSorted((a, b) => b.from - a.from)) out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return out;
}

/** The marks the request names, or `refused` when its index holds another kind. */
function targets(text: string, request: ResolveRequest): MarkRange[] | "refused" | null {
  const scan = scanMarks(text);
  if (scan.malformed) return null;
  const open = scan.marks.filter((mark) => mark.kind !== "source");
  const kind = KIND[request.action];
  if (!("index" in request)) return open.filter((mark) => mark.kind === kind);
  const mark = open[request.index];
  if (mark === undefined) return [];
  return mark.kind === kind ? [mark] : "refused";
}

/**
 * Deletions for whole marks. Each takes its spacing (`wholeMarkRange`), so two
 * neighbouring block marks can claim the same blank line: overlapping ranges
 * merge into one, or applying both would delete text past them.
 */
function removeChanges(text: string, marks: readonly MarkRange[]): TextChange[] {
  const changes: TextChange[] = [];
  for (const mark of marks) {
    const range = wholeMarkRange(text, { from: mark.openFrom, to: mark.closeTo });
    const last = changes.at(-1);
    if (last !== undefined && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else changes.push({ ...range, insert: "" });
  }
  return changes;
}

export function resolveEdit(text: string, request: ResolveRequest): ResolveEdit {
  const marks = targets(text, request);
  if (marks === null || marks === "refused") return { status: "refused" };
  if (marks.length === 0) return { status: "nothing" };
  const changes = KIND[request.action] === "note"
    ? removeChanges(text, marks)
    // `acceptChanges` sees only the named marks, so it unmarks just those, and refuses an unclean result itself.
    : acceptChanges(text, { marks, selection: { from: 0, to: text.length } });
  if (changes.length === 0) return { status: "refused" };
  const next = apply(text, changes);
  return scanMarks(next).malformed ? { status: "refused" } : { status: "edit", text: next };
}
