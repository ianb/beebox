// # Openers live on the place's landmark
//
// An opener is a one-line first move shown on an unstarted chat in a place (and,
// later, on the place page). A place carries its own openers under the landmark's
// `navigation.openers`, and `landmarks.forDir` ships them on its payload, so the
// chat reads the same request it already makes for the place's links
// (docs/implemented-plans/landmark-arrival.md, Track B).
//
// There is no inheritance: a place whose landmark lists no openers shows none,
// and a directory with no landmark has no payload at all.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { createLandmarkTemplate, LandmarkNavigation, STOCK_ROOT_OPENERS, STOCK_ROOT_SUMMARY } from "../../../../src/schemas/landmark.js";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, actor: "none" });
  return appRouter.createCaller(ctx);
}

async function openersFor(boxRoot: string, dir: string) {
  const { landmark } = await caller(boxRoot).landmarks.forDir({ dir });
  return landmark === null ? null : landmark.openers;
}

/** Does this `navigation.openers` list pass the landmark schema? */
function opensOk(openers: string[]): boolean {
  return LandmarkNavigation.safeParse({ openers }).success;
}

const ROOT = "---\nnavigation:\n  label: test\n  openers:\n    - Let me tell you what this box is for.\n    - What can you do?\n---\n";

// ## The root place's openers come from the landmark under `_content/`
//
// The root place is the logical directory `""`; its landmark lives at
// `_content/*.landmark.card`. The old briefing reader joined `""` with the
// briefing's name and looked at the box root, so no box showed root openers.
void test("The root place is the logical directory \"\"; its landmark lives at content/.la...", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/Box.landmark.card", ROOT);
  t.check(await openersFor(box.root, ""), [
    "Let me tell you what this box is for.",
    "What can you do?",
  ]);
});

// ## Each place has its own list, trimmed
void test("Each place has its own list, trimmed", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/Box.landmark.card", ROOT);
  await box.write("_content/lending/Lending.landmark.card",
    "---\nnavigation:\n  label: Lending\n  openers:\n    - \"  Who has what right now?  \"\n    - Log a new loan\n---\n");
  t.check(await openersFor(box.root, "_content/lending"), [
    "Who has what right now?",
    "Log a new loan",
  ]);
});

// ## A place without openers shows none; it does not inherit the root's
//
// A landmark with no `openers` key and a landmark with `openers: []` both answer
// `[]`, even though the root lists two.
void test("A landmark with no openers key and a landmark with openers:", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/Box.landmark.card", ROOT);
  await box.write("_content/garden/Garden.landmark.card", "---\nnavigation:\n  label: Garden\n---\n");
  await box.write("_content/swim/Swim.landmark.card", "---\nnavigation:\n  label: Swim\n  openers: []\n---\n");
  t.check(({ garden: await openersFor(box.root, "_content/garden"), swim: await openersFor(box.root, "_content/swim") }), {
    garden: [],
    swim: [],
  });
});

// ## A directory with no landmark has no payload
void test("A directory with no landmark has no payload", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/Box.landmark.card", ROOT);
  await box.write("_content/loose/Note.doc.card", "---\ntitle: note\n---\n");
  t.check(await openersFor(box.root, "_content/loose"), null);
});

// ## An invalid opener makes the landmark fail to parse
//
// An opener is a single non-blank line of at most 120 characters. A landmark
// that breaks the rule does not load (the Landmarks page shows it as a parse
// warning), so `forDir` answers as if there were no landmark rather than
// quietly dropping the bad entry.
void test("An opener is a single non-blank line of at most 120 characters.", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/broken/Broken.landmark.card",
    "---\nnavigation:\n  label: Broken\n  openers:\n    - \"\"\n---\n");
  t.check(await openersFor(box.root, "_content/broken"), null);
});

// The validation, case by case. Surrounding whitespace is allowed; the length
// limit is measured on the trimmed text.
void test("The validation, case by case.", async (t) => {
  t.check(
    ({ ok: opensOk(["What can you do?"]), padded: opensOk(["  What can you do?  "]),
      limit: opensOk(["x".repeat(120)]), blank: opensOk(["   "]), empty: opensOk([""]),
      multiLine: opensOk(["Tell me about the box.\nAnd the people in it."]), long: opensOk(["x".repeat(121)]) }),
    {
    ok: true,
    padded: true,
    limit: true,
    blank: false,
    empty: false,
    multiLine: false,
    long: false,
  },
  );
});

// ## The payload says whether the root's summary is still stock
//
// The phone's empty root chat shows the stock summary's first two sentences
// above the openers, and only while the root landmark's body is the text a new
// box ships with (docs/plans/front-door.md, Track A). `stockSummary` rides on
// the same `forDir` payload as the openers. A one-word edit makes the body the
// person's, and a nested place is never the front door, whatever its body says.
void test("The phone's empty root chat shows the stock summary's first two sentences abo...", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/Box.landmark.card", createLandmarkTemplate({ label: "test", openers: STOCK_ROOT_OPENERS, body: STOCK_ROOT_SUMMARY }));
  await box.write("_content/lending/Lending.landmark.card", createLandmarkTemplate({ label: "Lending", body: STOCK_ROOT_SUMMARY }));
  const stockFor = async (dir: string) => (await caller(box.root).landmarks.forDir({ dir })).landmark?.stockSummary;
  const fresh = { root: await stockFor(""), lending: await stockFor("_content/lending") };
  await box.write("_content/Box.landmark.card", createLandmarkTemplate({ label: "test", body: STOCK_ROOT_SUMMARY.replace("This is your box.", "This is our box.") }));
  t.check({ ...fresh, edited: await stockFor("") }, {
    root: true,
    lending: false,
    edited: false,
  });
});
