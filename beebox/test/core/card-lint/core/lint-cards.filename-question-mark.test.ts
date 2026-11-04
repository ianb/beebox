// # A `?` in a card filename is an error
//
// A card link is `/<box>/views/<path>`, and the open card is the `?card=` value.
// Both are view URLs, where the first `?` starts the query, so a card named
// `Soup?.doc.card` would open `Soup`. `lintCardsDispatch` rejects the name.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { lintCardsDispatch } from "../../../../src/core/card-lint/core/lint-cards.js";
import { DocSchema } from "../../../../src/schemas/doc.js";
import type { CardSchema } from "../../../../src/cards/schema.js";

const ctx = { cardSchemas: new Map<string, CardSchema>([[DocSchema.type, DocSchema]]) };

/** The error messages for one card file. */
async function errors(name: string): Promise<string[]> {
  const box = await makeTmpBox();
  await box.write(`_content/${name}`, "---\ntitle: Soup\n---\nStock first.\n");
  const result = await lintCardsDispatch([box.path(`_content/${name}`)], { boxRoot: box.root, ctx });
  await box.cleanup();
  return result.results[0]!.errors.map((e) => e.message);
}

void test("A `?` in a card filename is an error", async (t) => {
  t.check(await errors("Soup?.doc.card"), ["card filename must not contain `?`: card links read it as the start of a query; rename the file"]);
});

// `#` and `%` stay allowed: card links encode them, and the route reads them back.
void test("`#` and `%` stay allowed", async (t) => {
  t.check(await errors("Soup #2.doc.card"), []);
  t.check(await errors("50% Soup.doc.card"), []);
});
