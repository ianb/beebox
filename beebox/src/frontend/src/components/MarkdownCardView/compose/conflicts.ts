/**
 * Merge conflicts shown in the compose editor (`docs/implemented-plans/composition-editor.md`,
 * Track 5). Where the agent and the person changed the same span, the
 * person's text stays and the agent's version shows after it as a widget,
 * "agent's version, not merged", with "Use this" (replace the span) and
 * "Dismiss". The widget lives only in the editor; it is never written to the
 * card. Its range maps through later edits like any CodeMirror range.
 */
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { MergeConflict } from "@shared/composition/merge";
import { el, widgetButton } from "./dom";

interface OpenConflict extends MergeConflict {
  id: number;
}

let nextId = 1;

/** New conflicts, in the coordinates of the transaction's resulting document. */
export const addConflicts = StateEffect.define<MergeConflict[]>();
const dropConflict = StateEffect.define<number>();

class ConflictWidget extends WidgetType {
  constructor(private readonly conflict: OpenConflict) {
    super();
  }

  eq(other: ConflictWidget): boolean {
    return other.conflict.id === this.conflict.id;
  }

  toDOM(view: EditorView): HTMLElement {
    const { id, remote } = this.conflict;
    const current = () => view.state.field(conflictsField).find((c) => c.id === id);
    const wrap = el("span", { className: "ml-1 rounded border border-dashed border-card-rule px-1 text-card-soft", text: "" });
    wrap.append(
      el("span", { className: "mr-1 text-xs font-medium", text: "agent's version, not merged:" }),
      el("span", { className: "text-card-ink", text: remote }),
      widgetButton({
        text: "Use this",
        label: "Use the agent's version",
        onClick: () => {
          const c = current();
          if (c !== undefined) view.dispatch({ changes: { from: c.from, to: c.to, insert: c.remote }, effects: dropConflict.of(id) });
        },
      }),
      widgetButton({ text: "Dismiss", label: "Dismiss the agent's version", onClick: () => view.dispatch({ effects: dropConflict.of(id) }) }),
    );
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const conflictsField = StateField.define<OpenConflict[]>({
  create: () => [],
  update(conflicts, tr) {
    let next = conflicts.map((c) => {
      const from = tr.changes.mapPos(c.from, 1);
      return { ...c, from, to: Math.max(from, tr.changes.mapPos(c.to, -1)) };
    });
    for (const effect of tr.effects) {
      if (effect.is(addConflicts)) next = [...next, ...effect.value.map((c) => ({ ...c, id: nextId++ }))];
      if (effect.is(dropConflict)) next = next.filter((c) => c.id !== effect.value);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (conflicts) =>
    Decoration.set(conflicts.map((c) => Decoration.widget({ widget: new ConflictWidget(c), side: 1 }).range(c.to)), true)),
});

export function openConflictCount(state: EditorState): number {
  return state.field(conflictsField).length;
}

export function conflictWidgets(): Extension {
  return conflictsField;
}
