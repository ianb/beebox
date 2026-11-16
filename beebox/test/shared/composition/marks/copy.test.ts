// # What Copy puts on the clipboard
//
// The publishing copy is the piece as published: the agent's words and
// quoted sources become plain text. Any open gap, note, or check blocks it,
// and it lists them instead (`plan:composition-copy-and-accept-all`). The
// draft copy keeps every open mark, labelled.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { draftCopy, publishingCopy } from "../../../../src/shared/composition/marks/copy.js";

const EACH_KIND = [
  'The garden was Odette\'s idea. {% editorial kind="joiner" %}After that,{% /editorial %} we planted it',
  "every year.",
  "",
  '{% editorial kind="gap" %}The first harvest.{% /editorial %}',
  "",
  'She said {% editorial kind="check" note="unclear" %}a week{% /editorial %}.',
  "",
  '{% editorial kind="note" %}',
  "Should this end here?",
  "{% /editorial %}",
].join("\n");

// ## Draft: each kind labelled; a check carries its reason
void test("draft with each kind", async (t) => {
  t.check(draftCopy(EACH_KIND), "The garden was Odette's idea. [agent: After that,] we planted it every year.\n\n[gap: The first harvest.]\n\nShe said [check: a week (why: unclear)].\n\n[note: Should this end here?]");
});

// ## Publishing: the gap, check, and note block it, by their place among the open marks; the joiner does not
void test("publishing blocked", async (t) => {
  t.check(publishingCopy(EACH_KIND), {
    status: "blocked",
    blockers: [
      { kind: "gap", index: 1, words: "The first harvest.", note: null },
      { kind: "check", index: 2, words: "a week", note: "unclear" },
      { kind: "note", index: 3, words: "Should this end here?", note: null },
    ],
  });
});

// ## Publishing: agent words, inline and block, become plain text
void test("publishing with joiners", async (t) => {
  const text = 'Odette planted it {% editorial kind="joiner" %}but{% /editorial %} late.\n\n{% editorial kind="joiner" %}\nThe first harvest.\n{% /editorial %}\n\nEnd.';
  t.check(publishingCopy(text), { status: "ready", text: "Odette planted it but late.\n\nThe first harvest.\n\nEnd." });
});

// ## `source` tags go and their words stay
void test("source tags", async (t) => {
  const text = [
    'Tomas remembers {% source ref="/_content/people/Tomas.person.card" usage="his telling" %}the hail that June{% /source %}.',
    "",
    "{% source %}",
    "A secondhand paragraph.",
    "{% /source %}",
  ].join("\n");
  t.check(publishingCopy(text), { status: "ready", text: "Tomas remembers the hail that June.\n\nA secondhand paragraph." });
});

// ## Tag syntax in a `process=false` fence: the draft keeps it as written. The
// mark scan does not know fences, so the publishing copy calls the text
// malformed, as the editor does (accepted: only text about tag syntax has it).
void test("literal tags in a fence", async (t) => {
  const text = 'Before.\n\n```{% process=false %}\n{% editorial kind="gap" %}literal{% /editorial %}\n```';
  t.check(draftCopy(text), text);
  t.check(publishingCopy(text), { status: "malformed" });
});

// ## Tag syntax inside inline code is literal text, beside a real mark on the same line
void test("inline code", async (t) => {
  const text = '`{% editorial kind="note" %}literal{% /editorial %}` and {% editorial kind="joiner" %}agent{% /editorial %}';
  t.check(publishingCopy(text), { status: "ready", text: '`{% editorial kind="note" %}literal{% /editorial %}` and agent' });
  t.check(draftCopy(text), '`{% editorial kind="note" %}literal{% /editorial %}` and [agent: agent]');
});

// ## Escaped backticks open no code span, so a mark between them is real
void test("escaped backticks", async (t) => {
  t.check(publishingCopy('\\`{% editorial kind="joiner" %}agent{% /editorial %}\\`'), { status: "ready", text: "\\`agent\\`" });
});

// ## A self-closing gap has no words; it still blocks, and the draft shows where it is
void test("self-closing gap", async (t) => {
  const text = 'End {% editorial kind="gap" /%}.';
  t.check(publishingCopy(text), { status: "blocked", blockers: [{ kind: "gap", index: 0, words: "", note: null }] });
  t.check(draftCopy(text), "End [gap].");
});

// ## An unclosed tag: no copy at all
void test("malformed", async (t) => {
  t.check(publishingCopy('A {% editorial kind="joiner" %}b'), { status: "malformed" });
});
