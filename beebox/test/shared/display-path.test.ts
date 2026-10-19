// # Display Path Vocabulary
//
// `toDisplayPath`/`fromDisplayPath` convert between the canonical box path form
// (`/_content/...`, used by refs/URLs/storage) and the boxholder-facing display
// form (BOXHOLDER-SETTLED, `docs/implemented-plans/one-root-box-layout.md`): a content path
// displays bare with no leading slash; any other area displays as
// `<AreaLabel>:path/inside`, with the label derived from the area name.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  areaDisplayLabel,
  detectDisplayFormPath,
  displayFormPathMessage,
  fromDisplayPath,
  toDisplayPath,
} from "../../src/shared/display-path.js";

// ## `toDisplayPath`
//
// A content path displays bare, no leading slash:
void test("A content path displays bare, no leading slash:", async (t) => {
  t.check(toDisplayPath("/_content/recipes/Soup.recipe.card"), "recipes/Soup.recipe.card");

  t.check(toDisplayPath("_content/recipes/Soup.recipe.card"), "recipes/Soup.recipe.card");
});

// A non-content area displays as `<AreaLabel>:path/inside`:
void test("A non-content area displays as <AreaLabel>:path/inside:", async (t) => {
  t.check(toDisplayPath("/_config/box.json"), "Config:box.json");

  t.check(toDisplayPath("/_bookkeeping/jobs/x.job.card"), "Bookkeeping:jobs/x.job.card");
});

// The content root displays as the empty string; the box root displays as `/`:
void test("The content root displays as the empty string; the box root displays as /:", async (t) => {
  t.check(toDisplayPath("/_content"), "");

  t.check(toDisplayPath("/"), "/");

  t.check(toDisplayPath(""), "/");
});

// An unknown top-level segment (shouldn't exist in a valid box) passes through
// unchanged:
void test("An unknown top-level segment (shouldn't exist in a valid box) passes through...", async (t) => {
  t.check(toDisplayPath("/src/tricks/scripts/foo.ts"), "/src/tricks/scripts/foo.ts");
});

// ## `fromDisplayPath`
//
// A bare or leading-slash path is content-relative:
void test("A bare or leading-slash path is content-relative:", async (t) => {
  t.check(fromDisplayPath("recipes/Soup.recipe.card"), "/_content/recipes/Soup.recipe.card");

  t.check(fromDisplayPath("/recipes/Soup.recipe.card"), "/_content/recipes/Soup.recipe.card");
});

// An area-label form (case-insensitive) maps to that area:
void test("An area-label form (case-insensitive) maps to that area:", async (t) => {
  t.check(fromDisplayPath("Config:box.json"), "/_config/box.json");

  t.check(fromDisplayPath("config:box.json"), "/_config/box.json");

  t.check(fromDisplayPath("Bookkeeping:jobs/x.job.card"), "/_bookkeeping/jobs/x.job.card");
});

// Raw canonical forms (already area-coded) pass through unchanged-to-canonical,
// with or without a leading slash:
void test("Raw canonical forms (already area-coded) pass through unchanged-to-canonical,...", async (t) => {
  t.check(fromDisplayPath("/_config/box.json"), "/_config/box.json");

  t.check(fromDisplayPath("_config/box.json"), "/_config/box.json");
});

// The empty string and `/` both mean the box root:
void test("The empty string and / both mean the box root:", async (t) => {
  t.check(fromDisplayPath(""), "/");

  t.check(fromDisplayPath("/"), "/");

  // ## Round trips
  //
  // Every display form round-trips through its canonical form:

  const cases = [
    "/_content/recipes/Soup.recipe.card",
    "/_config/box.json",
    "/_bookkeeping/jobs/x.job.card",
    "/_publish/site/index.html",
    "/_tmp/scratch.txt",
  ];
  const roundTripped = cases.map((canonical) => fromDisplayPath(toDisplayPath(canonical)));
  t.check(roundTripped, [
    "/_content/recipes/Soup.recipe.card",
    "/_config/box.json",
    "/_bookkeeping/jobs/x.job.card",
    "/_publish/site/index.html",
    "/_tmp/scratch.txt",
  ]);
});

// ## `areaDisplayLabel`
//
// Derived from the area name — strip the underscore, capitalize the first
// letter:
void test("Derived from the area name — strip the underscore, capitalize the first letter:", async (t) => {
  t.check(areaDisplayLabel("_config"), "Config");

  t.check(areaDisplayLabel("_bookkeeping"), "Bookkeeping");
});

// ## `detectDisplayFormPath`
//
// A case-insensitive area label followed by `:` is a display-form leak:
void test("A case-insensitive area label followed by : is a display-form leak:", async (t) => {
  t.check(detectDisplayFormPath("Config:box.json"), {
    canonical: "/_config/box.json",
    areaLabel: "Config",
  });

  t.check(detectDisplayFormPath("bookkeeping:jobs/x.job.card"), {
    canonical: "/_bookkeeping/jobs/x.job.card",
    areaLabel: "Bookkeeping",
  });
});

// A bare area label with nothing after the colon still matches:
void test("A bare area label with nothing after the colon still matches:", async (t) => {
  t.check(detectDisplayFormPath("Config:"), {
    canonical: "/_config",
    areaLabel: "Config",
  });
});

// `content:` is NEVER a display-form match — it is a real, registered URI
// scheme, and `_content` displays bare (never with a label):
void test("content: is NEVER a display-form match — it is a real, registered URI scheme,...", async (t) => {
  t.check(detectDisplayFormPath("content:box.json"), null);
});

// A `<label>://` double-slash form is a URL, never a display form:
void test("A <label>:// double-slash form is a URL, never a display form:", async (t) => {
  t.check(
    detectDisplayFormPath("Config://box.json")
    ,
    null,
  );
});

// A bare relative path, an unrelated colon, or an unrecognized label all miss —
// the bare form is handled separately, as a "did you mean" suggestion at
// diagnostic boundaries, not by this detector:
void test("A bare relative path, an unrelated colon, or an unrecognized label all miss —...", async (t) => {
  t.check(detectDisplayFormPath("recipes/Soup.recipe.card"), null);

  t.check(detectDisplayFormPath("Recipe:Soup.card"), null);
});

// ## `displayFormPathMessage`
//
// The canonical caller-visible message, shared by every choke point:
void test("The canonical caller-visible message, shared by every choke point:", async (t) => {
  const match = detectDisplayFormPath("Config:box.json");
  t.check(match === null ? "unexpected null" : displayFormPathMessage("Config:box.json", match), "`Config:box.json` is the boxholder's display form; write `/_config/box.json`");
});
