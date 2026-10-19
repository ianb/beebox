// # Gemini JSON response boundary (Track D.5)
//
// `describe-images-helpers.ts` and `scan-import-gemini.ts` used to describe
// their Gemini response shape three times over (a hand-written TS interface, a
// hand-written `responseSchema` object for the API, and a bare
// `JSON.parse(...) as X[]` cast). `parseGeminiJsonArray` is now the single
// validation boundary shared by both: valid elements pass through, an
// individual malformed element is dropped and logged (mirroring the existing
// out-of-range-index drop in `scan-import-helpers.ts`) rather than failing the
// whole batch, and a malformed top-level shape (not JSON, or not an array)
// throws a distinct `GeminiResponseShapeError` rather than either crashing
// uninformatively or silently producing garbage.

import { test } from "tap";
import "agent-doctest/tap";
import { z } from "zod";
import { parseGeminiJsonArray } from "../../../src/core/describe-images/helpers.js";

const itemSchema = z.object({ index: z.number(), label: z.string() });
const logged: string[] = [];
const log = function (line: string): void { logged.push(line); };

// An element that fails the schema is dropped and logged; the rest still load:
void test("An element that fails the schema is dropped and logged; the rest still load:", async (t) => {
  logged.length = 0;
  const mixed = parseGeminiJsonArray(JSON.stringify([{ index: 0, label: "a" }, { index: "not-a-number", label: "b" }]), { itemSchema, log });
  t.check(mixed, [
    {
      index: 0,
      label: "a",
    },
  ]);

  t.check(logged, ["Gemini response entry 1 failed validation, dropping: Invalid input: expected number, received string"]);

  // Invalid JSON is a whole-response failure, distinct from a Gemini API failure
  // (`GeminiEmptyResponseError`, a separate class for when Gemini itself declined
  // to answer):

  await t.checkThrows(async () => (parseGeminiJsonArray("not json", { itemSchema })), "GeminiResponseShapeError");

  // A validly-parsed but non-array top level is the same distinct failure:

  await t.checkThrows(async () => (parseGeminiJsonArray(JSON.stringify({ index: 0 }), { itemSchema })), "GeminiResponseShapeError");
});
