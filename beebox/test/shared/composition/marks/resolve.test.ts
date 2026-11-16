// # The edits behind the composition's resolve actions
//
// Each action unmarks or removes one kind of mark, or one mark by its place
// among the open marks. An edit that would leave the text malformed is
// refused, and an index that holds another kind is refused
// (`plan:composition-copy-and-accept-all`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { resolveEdit } from "../../../../src/shared/composition/marks/resolve.js";

const J = (words: string) => `{% editorial kind="joiner" %}${words}{% /editorial %}`;
const C = (words: string) => `{% editorial kind="check" note="date?" %}${words}{% /editorial %}`;
const N = (words: string) => `{% editorial kind="note" %}${words}{% /editorial %}`;
const G = (words: string) => `{% editorial kind="gap" %}${words}{% /editorial %}`;

// Open marks in order: 0 joiner, 1 check, 2 note, 3 joiner, 4 gap.
const TEXT = `Odette planted ${J("but")} late, in ${C("May")}. ${N("Shorter?")} It rained ${J("but")} held.\n\n${G("a sentence on cost")}`;

// ## Accept all agent words: every joiner unmarked, the rest kept
void test("accept joiners", async (t) => {
  t.check(resolveEdit(TEXT, { action: "accept-joiners" }), {
    status: "edit",
    text: `Odette planted but late, in ${C("May")}. ${N("Shorter?")} It rained but held.\n\n${G("a sentence on cost")}`,
  });
});

// ## Remove all notes: the note goes with one of its spaces
void test("remove notes", async (t) => {
  t.check(resolveEdit(TEXT, { action: "remove-notes" }), {
    status: "edit",
    text: `Odette planted ${J("but")} late, in ${C("May")}. It rained ${J("but")} held.\n\n${G("a sentence on cost")}`,
  });
});

// ## One mark by index: keep the check at 1; an index holding another kind is refused
void test("one mark", async (t) => {
  t.check(resolveEdit(TEXT, { action: "keep-check", index: 1 }), {
    status: "edit",
    text: `Odette planted ${J("but")} late, in May. ${N("Shorter?")} It rained ${J("but")} held.\n\n${G("a sentence on cost")}`,
  });
  t.check(resolveEdit(TEXT, { action: "remove-note", index: 1 }), { status: "refused" });
  t.check(resolveEdit(TEXT, { action: "remove-note", index: 9 }), { status: "nothing" });
});

// ## Nothing of that kind: nothing to do; malformed text: refused
void test("nothing and malformed", async (t) => {
  t.check(resolveEdit("Plain words.", { action: "keep-checks" }), { status: "nothing" });
  t.check(resolveEdit("A {% editorial kind=\"note\" %}b", { action: "remove-notes" }), { status: "refused" });
});

// ## A joiner holding inline code is accepted whole; a closer hidden in a code span makes the text malformed, so it is refused
void test("inline code", async (t) => {
  t.check(resolveEdit(`${J("see `x` here")}`, { action: "accept-joiners" }), { status: "edit", text: "see `x` here" });
  t.check(resolveEdit("{% editorial kind=\"joiner\" %}`a{% /editorial %}`", { action: "accept-joiners" }), { status: "refused" });
});
