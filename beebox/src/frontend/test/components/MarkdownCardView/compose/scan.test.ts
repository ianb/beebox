// # Where the marks are in composition text
//
// `scanMarks` gives each `editorial` and `source` mark's delimiter offsets,
// which the compose editor turns into widgets. A tag that is unclosed,
// mismatched, or names an unknown kind makes the whole text `malformed`, and
// the editor shows it raw (`docs/plans/composition-editor.md`, Failure modes).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { scanMarks, wholeMarkRange } from "../../../../src/components/MarkdownCardView/compose/scan.js";

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
