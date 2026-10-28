// # Doc card lint: compositions
//
// Doc cards declare `composition` and `editorial` as scoped tags. A body that
// uses them correctly lints clean; a bad mark kind and a second composition
// warn (body lint is warning-only, so neither blocks a commit).

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import type { CardSchema } from "../../src/exports/cards.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { lintCardsDispatch } from "../../src/core/card-lint/core/lint-cards.js";
import type { LoadCardContext } from "../../src/core/card-io.js";
import { DocSchema } from "../../src/schemas/doc.js";

const ctx: LoadCardContext = { cardSchemas: new Map<string, CardSchema>([["doc", DocSchema]]) };

const COMPOSITION = '{% composition %}\nThe garden was Odette\'s idea. {% editorial kind="joiner" %}After that,{% /editorial %} we planted it.\n\n{% editorial kind="gap" %}The first harvest.{% /editorial %}\n{% /composition %}\n';

async function lintBody(t: Test, body: string): Promise<string[]> {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const path = "_content/store/Garden.doc.card";
  await box.write(path, `---\ntype: doc\ntitle: Garden\n---\n${body}`);
  const result = await lintCardsDispatch([box.path(path)], { boxRoot: box.root, ctx });
  return result.results.flatMap((entry) => [...entry.errors, ...entry.warnings].map((issue) => `${issue.severity}: ${issue.message}`));
}

void test("a doc with a composition and marks lints clean", async (t) => {
  t.check(await lintBody(t, `Notes outside.\n\n${COMPOSITION}\n## Revision notes\n`), []);
});

void test("an unknown editorial kind warns", async (t) => {
  t.check(await lintBody(t, '{% composition %}\nText {% editorial kind="other" %}x{% /editorial %}.\n{% /composition %}\n'), [
    "warning: Markdoc body issue at line 2 (editorial): Attribute 'kind' must match one of [\"joiner\",\"gap\",\"note\",\"check\"]. Got 'other' instead.",
  ]);
});

// `validate` sees one node at a time; the whole-body check counts compositions.
void test("a second composition warns", async (t) => {
  t.check(await lintBody(t, `${COMPOSITION}\n${COMPOSITION}`), [
    "warning: Composition: this body has more than one {% composition %}; a card has at most one",
  ]);
});

void test("an inline or unclosed composition warns", async (t) => {
  t.check(await lintBody(t, "Text {% composition %}x{% /composition %}.\n"), [
    "warning: Markdoc body issue at line 1 (composition): A composition is a block: put {% composition %} and {% /composition %} each on its own line",
    "warning: Composition: {% composition %} is inline; put the opening and closing tags each on its own line",
  ]);
  t.check(await lintBody(t, "{% composition %}\nNo closer.\n"), [
    "warning: Markdoc body issue at line 1 (composition): Node 'composition' is missing closing",
    "warning: Composition: {% composition %} has no matching {% /composition %}, or a tag inside it is unclosed",
  ]);
});
