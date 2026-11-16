// # Where the marks are in composition text
//
// `scanMarks` gives each `editorial` and `source` mark's delimiter offsets,
// which the compose editor turns into widgets. A tag that is unclosed,
// mismatched, or names an unknown kind makes the whole text `malformed`, and
// the editor shows it raw (`plan:composition-editor`, Failure modes).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { acceptChanges, emptyJoinerRanges, scanMarks, wholeMarkRange, type TextChange } from "../../../../src/components/MarkdownCardView/compose/scan.js";

// ## Inline marks of each kind, with their delimiter ranges
void test("inline marks", async (t) => {
  const text = 'A {% editorial kind="gap" %}fill{% /editorial %} b {% editorial kind="check" note="unclear" %}in this world{% /editorial %} {% source ref="x.card" %}said{% /source %}.';
  const scan = scanMarks(text);
  t.check(scan, {
    malformed: false,
    marks: [
      { kind: "gap", openFrom: 2, openTo: 28, closeFrom: 32, closeTo: 48, note: null },
      { kind: "check", openFrom: 51, openTo: 94, closeFrom: 107, closeTo: 123, note: "unclear" },
      { kind: "source", openFrom: 124, openTo: 149, closeFrom: 153, closeTo: 166, note: null },
    ],
  });
  const [gap] = scan.marks;
  t.check(gap === undefined ? null : text.slice(gap.openTo, gap.closeFrom), "fill");
});

// ## A block mark on its own lines, and a self-closing gap
void test("block and self-closing marks", async (t) => {
  t.check(scanMarks('{% editorial kind="note" %}\nShorter?\n{% /editorial %}\n\nEnd {% editorial kind="gap" /%}.'), {
    malformed: false,
    marks: [
      { kind: "note", openFrom: 0, openTo: 27, closeFrom: 37, closeTo: 53, note: null },
      { kind: "gap", openFrom: 59, openTo: 86, closeFrom: 86, closeTo: 86, note: null },
    ],
  });
});

// ## No marks
void test("plain text", async (t) => {
  t.check(scanMarks("Just the person's words."), { malformed: false, marks: [] });
});

// ## Malformed: unclosed, mismatched, unknown kind, stray closer
void test("malformed", async (t) => {
  const malformed = { malformed: true, marks: [] };
  t.check(scanMarks('Ran {% editorial kind="gap" %}fast.'), malformed);
  t.check(scanMarks('{% editorial kind="gap" %}x{% /source %}'), malformed);
  t.check(scanMarks('{% editorial kind="draft" %}x{% /editorial %}'), malformed);
  t.check(scanMarks("x{% /editorial %}"), malformed);
});

// ## Pasted tag syntax: a valid tag becomes a mark; broken syntax stays text
void test("pasted tag syntax", async (t) => {
  t.check(scanMarks('Pasted {% editorial kind="joiner" %}words{% /editorial %}').marks.map((m) => m.kind), ["joiner"]);
  t.check(scanMarks("Pasted {% editorial kind=").malformed, false);
});

// ## Tag syntax inside inline code stays text; a real mark beside it is found
void test("inline code", async (t) => {
  t.check(scanMarks('`{% editorial kind="note" %}literal{% /editorial %}` and {% editorial kind="joiner" %}agent{% /editorial %}'), {
    malformed: false,
    marks: [{ kind: "joiner", openFrom: 57, openTo: 86, closeFrom: 91, closeTo: 107, note: null }],
  });
});

// ## Escaped backticks open no code span: the mark between them is found
void test("escaped backticks", async (t) => {
  t.check(scanMarks('\\`{% editorial kind="joiner" %}agent{% /editorial %}\\`').marks.map((m) => m.kind), ["joiner"]);
});

// ## Removing a whole mark leaves single spacing: one blank line between paragraphs, one space between words
void test("whole-mark removal range", async (t) => {
  const remove = (text: string, mark: string) => {
    const from = text.indexOf(mark);
    const range = wholeMarkRange(text, { from, to: from + mark.length });
    return text.slice(0, range.from) + text.slice(range.to);
  };
  const gap = '{% editorial kind="gap" %}x{% /editorial %}';
  t.check(remove(`A.\n\n${gap}\n\nB.`, gap), "A.\n\nB.");
  t.check(remove(`A.\n\n${gap}`, gap), "A.");
  t.check(remove(`${gap}\n\nB.`, gap), "B.");
  t.check(remove(`them. ${gap} By May`, gap), "them. By May");
  t.check(remove(`them. ${gap}\n\nNext.`, gap), "them.\n\nNext.");
  t.check(remove(`(${gap}) words`, gap), "() words");
});

// # Accepting agent words as the person's
//
// `acceptChanges` removes the mark from the joiner or check words at the
// selection and keeps the words. Each case gives the text with the selection
// written as `[` and `]`, or a cursor as `|`, and the text after accepting.

const J = '{% editorial kind="joiner" %}';
const E = "{% /editorial %}";

function applyChanges(text: string, changes: TextChange[]): string {
  let out = text;
  for (const change of changes.toSorted((a, b) => b.from - a.from)) out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return out;
}

function accept(marked: string): string {
  const cursor = marked.indexOf("|");
  const from = cursor !== -1 ? cursor : marked.indexOf("[");
  const text = cursor !== -1 ? marked.replace("|", "") : marked.replace("[", "").replace("]", "");
  const to = cursor !== -1 ? cursor : marked.indexOf("]") - 1;
  return applyChanges(text, acceptChanges(text, { marks: scanMarks(text).marks, selection: { from, to } }));
}

// ## A selection over part of a joiner splits it; spaces at the cut stay outside the marks
void test("partial selection splits the joiner", async (t) => {
  t.check(accept(`Odette. ${J}After that [first] spring,${E} we planted.`), `Odette. ${J}After that${E} first ${J}spring,${E} we planted.`);
  t.check(accept(`${J}[After that] first spring,${E} we`), `After that ${J}first spring,${E} we`);
  t.check(accept(`${J}After that first [spring,${E} we]`), `${J}After that first${E} spring, we`);
});

// ## A cursor inside a joiner, or on its edge, accepts the whole joiner
void test("cursor accepts the whole segment", async (t) => {
  t.check(accept(`Odette. ${J}After that fi|rst spring,${E} we planted.`), "Odette. After that first spring, we planted.");
  t.check(accept(`Odette. |${J}After${E} we`), "Odette. After we");
  t.check(accept(`Odette. ${J}After${E}| we`), "Odette. After we");
  t.check(accept(`Odet|te. ${J}After${E} we`), `Odette. ${J}After${E} we`);
});

// ## A check accepts the same way and keeps its note on the part left marked
void test("check marks", async (t) => {
  const C = '{% editorial kind="check" note="unclear audio" %}';
  t.check(accept(`${C}in [this] world${E}`), `${C}in${E} this ${C}world${E}`);
  t.check(accept(`${C}in th|is world${E}`), "in this world");
});

// ## Gaps and notes are placeholders, so accepting leaves them alone
void test("gaps and notes are not accepted", async (t) => {
  const gap = '{% editorial kind="gap" %}connect the two{% /editorial %}';
  const note = '{% editorial kind="note" %}Shorter?{% /editorial %}';
  t.check(accept(`A ${gap.replace("connect", "con|nect")} B`), `A ${gap} B`);
  t.check(accept(`[A ${note} B]`), `A ${note} B`);
});

// ## One selection across two joiners accepts the selected part of each
void test("selection across two joiners", async (t) => {
  t.check(accept(`${J}One [two${E} mine ${J}three] four${E}`), `${J}One${E} two mine three ${J}four${E}`);
});

// ## A block joiner on its own lines: whole accept drops the tag lines; a split leaves one inline mark per line
void test("block joiners", async (t) => {
  t.check(accept(`A.\n\n${J}\nBridge| one.\n\nBridge two.\n${E}\n\nB.`), "A.\n\nBridge one.\n\nBridge two.\n\nB.");
  t.check(accept(`${J}\nBridge [one].\n\nBridge two.\n${E}`), `${J}Bridge${E} one${J}.${E}\n\n${J}Bridge two.${E}`);
});

// ## A joiner whose words were all deleted goes away with its spacing
void test("empty joiners", async (t) => {
  const text = `them. ${J}${E} By May ${J}kept${E}`;
  const after = applyChanges(text, emptyJoinerRanges(text, scanMarks(text).marks).map((r): TextChange => ({ ...r, insert: "" })));
  t.check(after, `them. By May ${J}kept${E}`);
});
