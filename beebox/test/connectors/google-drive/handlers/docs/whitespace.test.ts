// # Drive push guard — stripped trailing whitespace
//
// `stripsUpstreamTrailingWhitespace` decides whether a local markdown body removed
// trailing whitespace from a line it otherwise kept. Google's Docs export uses
// that whitespace as a line break inside nested list items, so a push that removes
// it collapses checklists into paragraphs upstream.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { stripsUpstreamTrailingWhitespace } from "../../../../../src/connectors/google-drive/handlers/docs/whitespace.js";

const remote = "- [ ] Parent  \n      - [ ] Child  \n";

// An unchanged file, and an edit that leaves the whitespace alone, both pass:
void test("An unchanged file, and an edit that leaves the whitespace alone, both pass:", async (t) => {
  // doctest:L17
  t.check(stripsUpstreamTrailingWhitespace(remote, remote), false);

  // doctest:L20
  t.check(stripsUpstreamTrailingWhitespace("- [ ] Parent  \n      - [x] Child  \n", remote), false);
});

// A whitespace sweep is caught — whether it is the only change, or bundled with a
// real content edit:
void test("A whitespace sweep is caught — whether it is the only change, or bundled with...", async (t) => {
  // doctest:L28
  t.check(stripsUpstreamTrailingWhitespace("- [ ] Parent\n      - [ ] Child\n", remote), true);

  // doctest:L31
  t.check(stripsUpstreamTrailingWhitespace("- [ ] Parent\n      - [x] Child\n", remote), true);
});

// Rewriting or deleting the line outright is a real edit, not a strip: the line
// did not survive, so there is no preserved line to have lost its break.
void test("Rewriting or deleting the line outright is a real edit, not a strip:", async (t) => {
  // doctest:L39
  t.check(stripsUpstreamTrailingWhitespace("- [ ] Parent  \n", remote), false);

  // doctest:L42
  t.check(stripsUpstreamTrailingWhitespace("- [ ] Parent  \n      - [ ] Rewritten child\n", remote), false);
});

// Adding content around the mirrored lines is fine, and whitespace on an
// otherwise-blank line counts the same as any other — MD009 flags those too, so
// they are exactly what a sweep removes:
void test("Adding content around the mirrored lines is fine, and whitespace on an otherw...", async (t) => {
  // doctest:L51
  t.check(stripsUpstreamTrailingWhitespace(`${remote}\nA new paragraph.\n`, remote), false);

  // doctest:L54
  t.check(stripsUpstreamTrailingWhitespace("Para\n\nNext\n", "Para\n   \nNext\n"), true);
});
