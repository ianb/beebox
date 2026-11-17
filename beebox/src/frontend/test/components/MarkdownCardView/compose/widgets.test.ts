// # The editor's open marks match Copy's
//
// Copy's "Go to it" names a mark by its place among the open marks in the
// text on disk; the editor shows that text normalized (hard-wrapped lines
// joined). Both must count the same marks in the same order, and the editor
// selects a gap or note whole and a joiner's or check's words
// (`plan:composition-copy-and-accept-all`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { EditorState } from "@codemirror/state";
import { openMarks } from "@shared/composition/marks/copy";
import { normalizeComposition } from "@shared/composition/marks/text";
import { markWidgets, openMarkRanges } from "../../../../src/components/MarkdownCardView/compose/widgets.js";

void test("editor marks match Copy's", async (t) => {
  const disk = [
    "A paragraph hard-wrapped",
    "across two lines, then",
    '{% editorial kind="joiner" %}but{% /editorial %} a {% source %}quote{% /source %}.',
    "",
    'Then {% editorial kind="gap" %}a sentence on cost{% /editorial %} and {% editorial kind="note" %}Shorter?{% /editorial %}.',
  ].join("\n");
  const state = EditorState.create({ doc: normalizeComposition(disk), extensions: markWidgets() });
  const editor = openMarkRanges(state).map((m) => ({ index: m.index, kind: m.kind, words: m.words, selects: state.sliceDoc(m.from, m.to) }));
  t.check(openMarks(disk)?.map((m) => ({ index: m.index, kind: m.kind, words: m.words })), editor.map(({ index, kind, words }) => ({ index, kind, words })));
  t.check(editor.map((m) => m.selects), [
    "but",
    '{% editorial kind="gap" %}a sentence on cost{% /editorial %}',
    '{% editorial kind="note" %}Shorter?{% /editorial %}',
  ]);
});
