// # search: areas hold back saved sources from default search
//
// A research box keeps thousands of saved sources in `_content/archive/`.
// `search.areas` in `_config/box.json` names that folder an area; default
// search leaves it out and says how many hits it held back, so the written
// cards come first and nothing looks missing
// (`docs/plans/knowledge-base-tools.md`, Track A). `_tmp/` is held back too,
// without a report.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { searchBox } from "../../../src/core/search/query/core.js";
import { clearBoxConfigCache } from "../../../src/core/box/config.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

delete process.env["BBX_OPENAI_API_KEY"];

function doc(title: string, body: string): string {
  return ["---", `title: ${title}`, "---", body, ""].join("\n");
}

async function areaBox(config: unknown) {
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify(config));
  clearBoxConfigCache(box.root);
  await box.write("_content/guidance/Income.doc.card", doc("Income limits", "Income limit for the program."));
  await box.write("_content/archive/Page1.doc.card", doc("Saved page one", "Income limit table, copied."));
  await box.write("_content/archive/Page2.doc.card", doc("Saved page two", "Another income limit table."));
  await box.write("_content/archive-notes/Notes.doc.card", doc("Archive notes", "Income limit remarks."));
  await box.write("_tmp/Scratch.doc.card", doc("Scratch", "Income limit scratch."));
  return box;
}

const CONFIG = { search: { areas: { archive: ["_content/archive"] } } };

function paths(res: { results: { path: string }[] }): string[] {
  return res.results.map((r) => r.path).toSorted();
}

void test("default search holds back an area and `_tmp/`, and counts the area", async (t) => {
  const box = await areaBox(CONFIG);
  t.teardown(() => box.cleanup());
  const res = await searchBox(box.root, { query: "income limit", mode: "text" });
  // `_content/archive-notes` shares the string prefix, not the path segment, so it stays.
  // `_tmp` is held back but not reported.
  t.check({ paths: paths(res), heldBack: res.heldBack, total: res.total }, {
    paths: ["_content/archive-notes/Notes.doc.card", "_content/guidance/Income.doc.card"],
    heldBack: [{ area: "archive", count: 2 }],
    total: 2,
  });
});

void test("--area names one area; `all` holds nothing back", async (t) => {
  const box = await areaBox(CONFIG);
  t.teardown(() => box.cleanup());
  const archive = await searchBox(box.root, { query: "income limit", mode: "text", area: "archive" });
  const all = await searchBox(box.root, { query: "income limit", mode: "text", area: "all" });
  t.check({ archive: paths(archive), archiveHeld: archive.heldBack, all: paths(all), allHeld: all.heldBack }, {
    archive: ["_content/archive/Page1.doc.card", "_content/archive/Page2.doc.card"],
    archiveHeld: [],
    all: [
      "_content/archive-notes/Notes.doc.card",
      "_content/archive/Page1.doc.card",
      "_content/archive/Page2.doc.card",
      "_content/guidance/Income.doc.card",
      "_tmp/Scratch.doc.card",
    ],
    allHeld: [],
  });
});

void test("a path prefix inside an area keeps its hits; one above it does not", async (t) => {
  const box = await areaBox(CONFIG);
  t.teardown(() => box.cleanup());
  const inside = await searchBox(box.root, { query: "income limit", mode: "text", pathPrefix: "_content/archive/" });
  const above = await searchBox(box.root, { query: "income limit", mode: "text", pathPrefix: "_content/" });
  t.check({ inside: paths(inside), insideHeld: inside.heldBack, above: paths(above), aboveHeld: above.heldBack }, {
    inside: ["_content/archive/Page1.doc.card", "_content/archive/Page2.doc.card"],
    insideHeld: [],
    above: ["_content/archive-notes/Notes.doc.card", "_content/guidance/Income.doc.card"],
    aboveHeld: [{ area: "archive", count: 2 }],
  });
});

void test("an unknown area fails with the known names", async (t) => {
  const box = await areaBox(CONFIG);
  t.teardown(() => box.cleanup());
  await t.checkThrows(
    () => searchBox(box.root, { query: "income", mode: "text", area: "archve" }),
    'UnknownAreaError: unknown area "archve" — valid areas: archive, all'
  );
});

void test("a kind weight multiplies the score before ranking", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  // Both cards match "pension" once in the title; the weight alone decides the order.
  await box.write("_config/box.json", JSON.stringify({ search: { kindWeights: { markdown: 100 } } }));
  clearBoxConfigCache(box.root);
  await box.write("people/Pension.doc.card", doc("Pension", "x"));
  await box.write("people/Pension.md", "# Pension\n\nx\n");
  const res = await searchBox(box.root, { query: "pension", mode: "text" });
  t.check(res.results.map((r) => r.kind), ["markdown", "doc"]);
});

void test("a malformed search config warns and filters nothing", async (t) => {
  const box = await areaBox({ search: { areas: { archive: "_content/archive" } } });
  t.teardown(() => box.cleanup());
  const res = await searchBox(box.root, { query: "income limit", mode: "text" });
  // Only `_tmp/`, which needs no config, is still left out.
  t.check({ warnings: res.warnings, held: res.heldBack, paths: paths(res) }, {
    warnings: ["_config/box.json search settings ignored, searching everything (search.areas.archive: Invalid input: expected array, received string)"],
    held: [],
    paths: [
      "_content/archive-notes/Notes.doc.card",
      "_content/archive/Page1.doc.card",
      "_content/archive/Page2.doc.card",
      "_content/guidance/Income.doc.card",
    ],
  });
});

// The old path filter fetched the top 1,000 hits and filtered afterwards, so a
// thousand archive matches could leave nothing behind.
void test("a held-back area bigger than the old fetch cap does not crowd out the answer", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_config/box.json", JSON.stringify(CONFIG));
  clearBoxConfigCache(box.root);
  for (let i = 0; i < 1100; i++) {
    await box.write(`_content/archive/P${String(i)}.doc.card`, doc(`Saved ${String(i)}`, "zebra zebra zebra zebra zebra"));
  }
  await box.write("_content/guidance/Zebra.doc.card", doc("Guidance", "A single mention of zebra."));
  const res = await searchBox(box.root, { query: "zebra", mode: "text" });
  t.check({ paths: paths(res), heldBack: res.heldBack }, {
    paths: ["_content/guidance/Zebra.doc.card"],
    heldBack: [{ area: "archive", count: 1100 }],
  });
});
