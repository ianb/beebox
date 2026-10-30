// # Merging the agent's change into the person's text
//
// `mergeComposition(base, {local, remote})` merges by word and space tokens; a
// span both sides changed keeps the local text and reports the remote text.
// `diffToChanges` gives the edits that turn one text into another, touching
// nothing outside them, so a cursor elsewhere stays put.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { diffToChanges, mergeComposition, type TextChange } from "../../../src/shared/composition/merge.js";

function apply(text: string, changes: readonly TextChange[]): string {
  let out = text;
  for (const change of changes.toReversed()) out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return out;
}

// ## Edits on both sides of a tag merge cleanly
void test("edits on both sides of a tag", async (t) => {
  const gap = '{% editorial kind="gap" %}connect the halves{% /editorial %}';
  t.check(mergeComposition(`Rain came. ${gap} Then sun.`, {
    local: `Rain came early. ${gap} Then sun.`,
    remote: `Rain came. ${gap} Then the sun.`,
  }), { merged: `Rain came early. ${gap} Then the sun.`, conflicts: [] });
});

// ## The agent splits a paragraph while the person types in another part of it
void test("paragraph split while typing", async (t) => {
  const base = "We left at dawn. The road was empty and the hills were brown.";
  t.check(mergeComposition(base, {
    local: "We left at dawn. The road was empty and the hills were brown and dry.",
    remote: "We left at dawn.\n\nThe road was empty and the hills were brown.",
  }), { merged: "We left at dawn.\n\nThe road was empty and the hills were brown and dry.", conflicts: [] });
  // Typing right beside the split point still merges, by character.
  t.check(mergeComposition(base, {
    local: "We left at dawns. The road was empty and the hills were brown.",
    remote: "We left at dawn.\n\nThe road was empty and the hills were brown.",
  }).merged, "We left at dawns.\n\nThe road was empty and the hills were brown.");
});

// ## Both change the same span: local kept, the range covers it, remote reported
void test("same-span conflict", async (t) => {
  const result = mergeComposition("Start. The old line here. End.", {
    local: "Start. The new line here. End.",
    remote: "Start. The agent line here. End.",
  });
  t.check(result, { merged: "Start. The new line here. End.", conflicts: [{ from: 11, to: 14, remote: "agent" }] });
  const [conflict] = result.conflicts;
  t.check(conflict === undefined ? null : result.merged.slice(conflict.from, conflict.to), "new");
});

// ## No change on either side, or the same change on both
void test("no-op", async (t) => {
  t.check(mergeComposition("Same text.", { local: "Same text.", remote: "Same text." }), { merged: "Same text.", conflicts: [] });
  t.check(mergeComposition("A b.", { local: "A c.", remote: "A c." }), { merged: "A c.", conflicts: [] });
  t.check(diffToChanges("Same text.", "Same text."), []);
});

// ## diffToChanges: minimal, ascending, and reproduces the target
void test("diffToChanges", async (t) => {
  const from = "Alpha beta gamma.\n\nDelta epsilon.";
  const to = "Alpha betas gamma.\n\nDelta new epsilon.";
  const changes = diffToChanges(from, to);
  t.check(changes, [{ from: 10, to: 10, insert: "s" }, { from: 25, to: 25, insert: "new " }]);
  t.check(apply(from, changes), to);
  t.check(apply("x y z", diffToChanges("x y z", "")), "");
  t.check(apply("", diffToChanges("", "new text")), "new text");
});
