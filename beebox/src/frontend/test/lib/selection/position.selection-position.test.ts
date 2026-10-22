// # Selection position formatting
//
// `formatPosition(parts)` renders the `SelectionParts` extracted from a
// document selection into the freeform `position` string carried by a
// `<user-selection>` tag. The agent reads it as a rough locator, not an exact
// offset. Clauses are omitted when their part is null.
//
// The DOM-walking half (`extractSelection`) is verified in the browser, since
// it depends on the live rendered document; this covers the pure formatter.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatPosition, formatTranscriptPosition } from "../../../src/lib/selection/position.js";

// ## Chat transcript selections name the chat and the speaker
//
// A selection from the chat transcript has no document behind it.
// `formatTranscriptPosition(startRole, endRole)` takes the `data-role` of the
// message holding each end of the selection.
void test("A selection from the chat transcript has no document behind it.", async (t) => {
  t.check(
    [
      formatTranscriptPosition("assistant", "assistant"),
      formatTranscriptPosition("user", "assistant"),
      formatTranscriptPosition("capture", "capture"),
      formatTranscriptPosition(null, null),
    ],
    [
    "chat transcript; assistant message",
    "chat transcript; spans several messages",
    "chat transcript",
    "chat transcript",
  ],
  );
});

// ## All parts present
void test("All parts present", async (t) => {
  t.check(
    formatPosition({
      section: "body",
      heading: { text: "Proofing the dough", id: "proofing-the-dough" },
      paragraph: 2,
      line: 42,
    }),
    "body; heading: Proofing the dough (#proofing-the-dough); paragraph 2; ~line 42",
  );
});

// ## No heading above the selection — clause omitted
void test("No heading above the selection — clause omitted", async (t) => {
  t.check(formatPosition({ section: "body", heading: null, paragraph: 3, line: null }), "body; paragraph 3");
});

// ## Heading and line, no section or paragraph
void test("Heading and line, no section or paragraph", async (t) => {
  t.check(
    formatPosition({
      section: null,
      heading: { text: "Notes", id: "notes" },
      paragraph: null,
      line: 5,
    }),
    "heading: Notes (#notes); ~line 5",
  );
});

// ## Frontmatter selection
void test("Frontmatter selection", async (t) => {
  t.check(formatPosition({ section: "frontmatter", heading: null, paragraph: null, line: null }), "frontmatter");
});

// ## Nothing determinable yields an empty string
void test("Nothing determinable yields an empty string", async (t) => {
  t.check(formatPosition({ section: null, heading: null, paragraph: null, line: null }), "");
});
