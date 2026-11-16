/**
 * The marks as widgets in the compose editor (`plan:composition-editor`,
 * Track 5). Gap and note marks are agent placeholders: each becomes one
 * atomic widget with "×" (remove the tag and its words). Joiner, check, and
 * source marks wrap words: only their delimiters become small atomic widgets
 * and the words stay editable. A joiner's words are the agent's, underlined
 * dotted; a joiner left with no words goes away. Check's "✓" and source's
 * "×" remove the delimiters and keep the text. `acceptSelection` accepts
 * joiner and check words at the selection (`acceptChanges`). Malformed text
 * gets no widgets.
 */
import { EditorSelection, EditorState, Prec, StateField, Transaction, type Extension, type Range, type RangeSet } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { el, widgetButton } from "./dom";
import { acceptChanges, emptyJoinerRanges, keepDelimiters, scanMarks, wholeMarkRange, type MarkKind, type MarkRange, type Scan } from "@shared/composition/marks/scan";

const WHOLE: ReadonlySet<MarkKind> = new Set(["gap", "note"]);

function deleteWhole(view: EditorView, range: { from: number; to: number }): void {
  view.dispatch({ changes: wholeMarkRange(view.state.doc.toString(), range), userEvent: "delete.mark" });
}

function removeWhole(view: EditorView, mark: MarkRange): void {
  deleteWhole(view, { from: mark.openFrom, to: mark.closeTo });
}

function unwrap(view: EditorView, mark: MarkRange): void {
  view.dispatch({
    changes: [{ from: mark.openFrom, to: mark.openTo }, { from: mark.closeFrom, to: mark.closeTo }],
    userEvent: "delete.mark",
  });
}

/** The mark whose widget starts where `dom` is now; positions move as the text changes. */
function markAt(view: EditorView, dom: HTMLElement): MarkRange | undefined {
  const pos = view.posAtDOM(dom);
  return view.state.field(marksField).scan.marks.find((mark) => mark.openFrom === pos);
}

class MarkWidget extends WidgetType {
  constructor(private readonly mark: { kind: MarkKind; content: string; note: string | null; opener: boolean }) {
    super();
  }

  eq(other: MarkWidget): boolean {
    const a = this.mark;
    const b = other.mark;
    return a.kind === b.kind && a.content === b.content && a.note === b.note && a.opener === b.opener;
  }

  toDOM(view: EditorView): HTMLElement {
    const { kind, content, note, opener } = this.mark;
    const act = (fn: (view: EditorView, mark: MarkRange) => void) => () => {
      const mark = markAt(view, wrap);
      if (mark !== undefined) fn(view, mark);
    };
    let wrap: HTMLElement;
    if (kind === "joiner") {
      wrap = el("span", { className: "", text: "" });
    } else if (kind === "gap" || kind === "note") {
      wrap = el("span", { className: "rounded bg-card-tint px-1 text-card-ink", text: "" });
      wrap.append(el("span", { className: "mr-1 text-xs font-medium text-card-soft", text: `${kind}:` }), content);
      wrap.append(widgetButton({ text: "×", label: `Remove ${kind}`, onClick: act(removeWhole) }));
    } else if (!opener) {
      wrap = el("span", { className: "text-xs text-card-soft", text: "⟩" });
    } else if (kind === "check") {
      wrap = el("span", { className: "text-xs text-card-soft", text: "" });
      wrap.append(widgetButton({ text: "✓", label: note === null ? "Accept" : `Accept (${note})`, onClick: act(unwrap) }));
    } else {
      wrap = el("span", { className: "text-xs text-card-soft", text: "source ⟨" });
      wrap.append(widgetButton({ text: "×", label: "Remove source mark", onClick: act(unwrap) }));
    }
    wrap.dataset["editorial"] = kind;
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

interface MarksValue {
  scan: Scan;
  decorations: DecorationSet;
  atomic: RangeSet<Decoration>;
}

function build(state: EditorState): MarksValue {
  const scan = scanMarks(state.doc.toString());
  const replaced: Range<Decoration>[] = [];
  const styled: Range<Decoration>[] = [];
  let hiddenTo = -1;
  for (const mark of scan.marks) {
    if (mark.openFrom < hiddenTo) continue;
    const content = state.sliceDoc(mark.openTo, mark.closeFrom);
    const widget = (opener: boolean) => Decoration.replace({ widget: new MarkWidget({ kind: mark.kind, content, note: mark.note, opener }) });
    if (WHOLE.has(mark.kind)) {
      replaced.push(widget(true).range(mark.openFrom, mark.closeTo));
      hiddenTo = mark.closeTo;
      continue;
    }
    replaced.push(widget(true).range(mark.openFrom, mark.openTo));
    if (mark.closeTo > mark.closeFrom) replaced.push(widget(false).range(mark.closeFrom, mark.closeTo));
    if (mark.closeFrom <= mark.openTo) continue;
    if (mark.kind === "check") {
      const attributes = mark.note === null ? undefined : { title: mark.note };
      styled.push(Decoration.mark({ class: "underline decoration-wavy decoration-card-pen underline-offset-4", attributes }).range(mark.openTo, mark.closeFrom));
    } else if (mark.kind === "joiner") {
      styled.push(Decoration.mark({ class: "underline decoration-dotted decoration-card-soft underline-offset-4", attributes: { title: "agent's words" } }).range(mark.openTo, mark.closeFrom));
    }
  }
  const atomic = Decoration.set(replaced, true);
  return { scan, atomic, decorations: Decoration.set([...replaced, ...styled], true) };
}

const marksField = StateField.define<MarksValue>({
  create: build,
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
});

export function isMalformed(state: EditorState): boolean {
  return state.field(marksField).scan.malformed;
}

/** Whether the selection touches joiner or check words that `acceptSelection` would accept. */
export function canAccept(state: EditorState): boolean {
  const { scan } = state.field(marksField);
  return !scan.malformed && acceptChanges(state.doc.toString(), { marks: scan.marks, selection: state.selection.main }).length > 0;
}

/**
 * Accepts the joiner and check words at the main selection as the person's:
 * the selected words, or the whole mark around an empty selection.
 */
export function acceptSelection(view: EditorView): boolean {
  const { state } = view;
  const { scan } = state.field(marksField);
  if (scan.malformed) return false;
  const changes = state.changes(acceptChanges(state.doc.toString(), { marks: scan.marks, selection: state.selection.main }));
  if (changes.empty) return false;
  const { main } = state.selection;
  const selection = main.empty
    ? EditorSelection.cursor(changes.mapPos(main.head, -1))
    : EditorSelection.range(changes.mapPos(main.anchor, main.anchor < main.head ? 1 : -1), changes.mapPos(main.head, main.head < main.anchor ? 1 : -1));
  view.dispatch({ changes, selection, userEvent: "accept.mark" });
  return true;
}

/** An open mark (not `source`) in the editor: its place among the open marks, and the range Go to selects. */
export interface OpenMarkRange {
  kind: Exclude<MarkKind, "source">;
  index: number;
  from: number;
  to: number;
  /** The mark's words, whitespace collapsed. */
  words: string;
}

/**
 * The open marks in text order. A gap or note is one widget, so its range is
 * the whole mark (typing replaces it); a joiner's or check's is its words.
 */
export function openMarkRanges(state: EditorState): OpenMarkRange[] {
  const { scan } = state.field(marksField);
  const out: OpenMarkRange[] = [];
  for (const mark of scan.marks) {
    if (mark.kind === "source") continue;
    const words = state.sliceDoc(mark.openTo, mark.closeFrom).replaceAll(/\s+/g, " ").trim();
    const [from, to] = WHOLE.has(mark.kind) ? [mark.openFrom, mark.closeTo] : [mark.openTo, mark.closeFrom];
    out.push({ kind: mark.kind, index: out.length, from, to, words });
  }
  return out;
}

/**
 * Select an open mark and scroll it into view. `false` (nothing selected)
 * when the mark at that index is not the one named: another kind or other
 * words, as when the agent added a mark before it since the person looked.
 */
export function selectOpenMark(view: EditorView, target: { index: number; kind: string; words: string }): boolean {
  const mark = openMarkRanges(view.state)[target.index];
  if (mark?.kind !== target.kind || mark.words !== target.words) return false;
  view.dispatch({ selection: EditorSelection.range(mark.from, mark.to), effects: EditorView.scrollIntoView(mark.from, { y: "center" }) });
  view.focus();
  return true;
}

/** A deletion that empties a joiner removes the joiner's tags too. */
const dropEmptyJoiners = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("delete") || tr.annotation(Transaction.remote) === true) return tr;
  const text = tr.newDoc.toString();
  const scan = scanMarks(text);
  if (scan.malformed) return tr;
  const ranges = emptyJoinerRanges(text, scan.marks);
  return ranges.length === 0 ? tr : [tr, { changes: ranges, sequential: true }];
});

/**
 * Typing over a selection, deleting one, cutting, word-delete, or a phone
 * keyboard's edit keeps any tag it would remove without its partner, so the
 * marks stay paired. Undo, remote merges, and the mark buttons pass through.
 */
const keepPairs = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(Transaction.remote) === true) return tr;
  if (!tr.isUserEvent("input") && !(tr.isUserEvent("delete") && !tr.isUserEvent("delete.mark"))) return tr;
  const { scan } = tr.startState.field(marksField);
  if (scan.malformed) return tr;
  const changes: { from: number; to: number; insert: string }[] = [];
  // eslint-disable-next-line max-params -- CodeMirror's iterChanges callback signature is fixed by the library.
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({ from, to, insert: inserted.toString() }));
  const kept = keepDelimiters(changes, scan.marks);
  if (kept === null) return tr;
  const set = tr.startState.changes(kept);
  // A delete that only reached kept tags steps over them, as Backspace and Delete do.
  if (set.empty) {
    const [first] = changes;
    const last = changes.at(-1);
    if (first === undefined || last === undefined) return tr;
    return { selection: EditorSelection.cursor(tr.isUserEvent("delete.forward") ? last.to : first.from), scrollIntoView: true };
  }
  const last = kept.findLast((c) => c.insert !== "") ?? kept.at(-1);
  const selection = tr.newSelection.main.empty && last !== undefined ? EditorSelection.cursor(set.mapPos(last.to, 1)) : undefined;
  return { changes: set, selection, effects: tr.effects, scrollIntoView: tr.scrollIntoView, userEvent: tr.annotation(Transaction.userEvent) };
});

/**
 * Backspace and Delete next to a mark: a whole-mark widget is deleted as one
 * unit; a delimiter is stepped over, so it never breaks its pair.
 */
function deleteAcross(forward: boolean) {
  return (view: EditorView): boolean => {
    const { main } = view.state.selection;
    if (!main.empty) return false;
    const { atomic, scan } = view.state.field(marksField);
    let found: { from: number; to: number; whole: boolean } | null = null;
    for (const iter = atomic.iter(main.head - 1); iter.value !== null && iter.from <= main.head; iter.next()) {
      if ((forward ? iter.from : iter.to) !== main.head) continue;
      const { from, to } = iter;
      const mark = scan.marks.find((m) => m.openFrom === from);
      found = { from, to, whole: mark !== undefined && WHOLE.has(mark.kind) && mark.closeTo === to };
      break;
    }
    if (found === null) return false;
    if (found.whole) deleteWhole(view, found);
    else view.dispatch({ selection: EditorSelection.cursor(forward ? found.to : found.from) });
    return true;
  };
}

export function markWidgets(): Extension {
  return [
    marksField,
    dropEmptyJoiners,
    // Filters run last-registered first: pairs are kept before empty joiners drop.
    keepPairs,
    Prec.high(keymap.of([
      { key: "Backspace", run: deleteAcross(false) },
      { key: "Delete", run: deleteAcross(true) },
      { key: "Mod-Shift-Enter", run: acceptSelection },
    ])),
    EditorView.editorAttributes.compute([marksField], (state) => ({
      class: isMalformed(state) ? "border border-dashed border-card-danger" : "",
    })),
  ];
}
