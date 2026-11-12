// # search: section results show their own text
//
// A long card body is indexed as one card document plus one document per
// section. A section result is shown under its card's title, and its preview
// is the section's own matching text, not the card's `contains` summary. A
// query for the card's title or summary finds the card once, not once per
// section (`issues/closed/bugs/2026-09-21-search-sections-repeat-the-card-summary.md`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { searchBox } from "../../../src/core/search/query/core.js";
import { SECTION_SPLIT_THRESHOLD } from "../../../src/core/search/extract/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

delete process.env["BBX_OPENAI_API_KEY"];

const FILLER = "remembered ".repeat(Math.ceil(SECTION_SPLIT_THRESHOLD / 20));
const FRIENDS = [
  "---",
  "title: Friends",
  "contains: Marisol and Noor, the neighbours who host the summer potluck",
  "---",
  "People I keep up with.",
  "",
  "# Marisol",
  `Marisol runs the potluck. ${FILLER}`,
  "",
  "# Bram",
  `Bram moved to Leeds; unsure of his new phone number. ${FILLER}`,
  "",
].join("\n");

void test("a section result previews its own text under the card's title", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_content/people/Friends.doc.card", FRIENDS);

  const res = await searchBox(box.root, { query: "Leeds", mode: "text" });
  // The score is BM25's; this file checks which document answers and how it reads.
  t.check(res.results.map(({ score: _score, ...hit }) => hit), [{
    path: "_content/people/Friends.doc.card",
    fragment: "/Bram",
    kind: "doc",
    title: "Friends",
    contains: "Marisol and Noor, the neighbours who host the summer potluck",
    excerpt: "Bram moved to Leeds; unsure of his new phone number. remembered remembered remembered remembered remembered remembered remembered...",
  }]);
});

void test("a title or summary query finds the card once, not every section", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_content/people/Friends.doc.card", FRIENDS);

  const byTitle = await searchBox(box.root, { query: "Friends", mode: "text", pathPrefix: "_content/people/" });
  const bySummary = await searchBox(box.root, { query: "neighbours", mode: "text", pathPrefix: "_content/people/" });
  t.check([byTitle.results.map((r) => r.fragment), bySummary.results.map((r) => r.fragment)], [[""], [""]]);
});
