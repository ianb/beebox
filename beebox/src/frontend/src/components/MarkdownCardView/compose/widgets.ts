/**
 * The marks as widgets in the compose editor (`docs/plans/composition-editor.md`,
 * Track 5). Gap, note, and joiner marks are agent text: each becomes one
 * atomic widget; gap and note have "×" (remove the tag and its words), a
 * joiner has no button and Backspace or Delete removes it whole. Check and
 * source marks wrap the person's text: only their delimiters become small
 * atomic widgets and the text stays editable; check's "✓" and source's "×"
 * remove the delimiters and keep the text. Malformed text gets no widgets.
 */
import { EditorSelection, Prec, StateField, type EditorState, type Extension, type Range, type RangeSet } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { el, widgetButton } from "./dom";
import { scanMarks, wholeMarkRange, type MarkKind, type MarkRange, type Scan } from "./scan";

const WHOLE: ReadonlySet<MarkKind> = new Set(["gap", "note", "joiner"]);

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
      wrap = el("span", { className: "underline decoration-dotted decoration-card-soft underline-offset-4", text: content });
      wrap.title = "agent's words";
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
    if (mark.kind === "check" && mark.closeFrom > mark.openTo) {
      const attributes = mark.note === null ? undefined : { title: mark.note };
      styled.push(Decoration.mark({ class: "underline decoration-wavy decoration-card-pen underline-offset-4", attributes }).range(mark.openTo, mark.closeFrom));
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
    Prec.high(keymap.of([{ key: "Backspace", run: deleteAcross(false) }, { key: "Delete", run: deleteAcross(true) }])),
    EditorView.editorAttributes.compute([marksField], (state) => ({
      class: isMalformed(state) ? "border border-dashed border-card-danger" : "",
    })),
  ];
}
