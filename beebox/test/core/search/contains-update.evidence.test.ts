// # `contains-evidence`: the derived detail behind a `contains`
//
// `contains-evidence` is an optional global card field holding the accumulated
// material a card's one-sentence `contains` was derived from — so a summary can
// show its work. Most cards never set it; the nightly chat review is its first
// consumer.
//
// It exists because `contains` cannot accumulate: `card-lint.ts` budgets it at one
// sentence, and it is the embedded retrieval field whose scoring was fitted against
// one-sentence text.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { setDerivedContains } from "../../../src/core/search/contains-update.js";
import { lintCardsDispatch } from "../../../src/core/card-lint/core/lint-cards.js";
import { buildLoadContext } from "../../../src/core/load-context.js";
import { computeContainsBasis } from "../../../src/core/search/contains-state.js";
import type { LoadedCard } from "../../../src/core/card-io.js";
import { createCardSchemaMap } from "../../../src/schemas.js";
import { invariant } from "../../../src/shared/invariant.js";
import { readFile } from "node:fs/promises";

const CARD = "store/notes/Trip.doc.card";

function doc(fields: string) {
  return `---\ntitle: Coast trip\n${fields}\n---\nBody text.\n`;
}

// ## An evidence-only write persists
//
// This is the regression anchor for a real bug: the original `contains` writer
// returned early without touching the card whenever `contains` itself was
// unchanged. Since an accumulating account grows on passes where the one-sentence
// summary stays accurate, evidence-only updates are the *common* case — they would
// have been silently dropped.
void test("This is the regression anchor for a real bug:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L39
  const box = await makeTmpBox();
  await box.write(CARD, doc("contains: A trip to the coast."));

  // doctest:L42
  const first = await setDerivedContains(box.root, {
    relPath: CARD,
    evidence: "- decision: booked the coast cottage",
  });
  t.check(first.unchanged, false);

  // doctest:L49
  const after = await readFile(box.path(CARD), "utf8");
  await t.checkText(after.includes("contains-evidence:") && after.includes("booked the coast cottage"), "true");

  // The `contains` sentence is left exactly as it was.

  // doctest:L57
  await t.checkText(after.includes("contains: A trip to the coast."), "true");

  // Writing the same evidence again is a no-op, so a nightly pass that finds nothing
  // new doesn't churn the card or its git history.

  // doctest:L65
  const second = await setDerivedContains(box.root, {
    relPath: CARD,
    evidence: "- decision: booked the coast cottage",
  });
  t.check(second.unchanged, true);

  // Both fields move together when both are supplied.

  // doctest:L76
  await setDerivedContains(box.root, {
    relPath: CARD,
    contains: "Planning a coast trip, now booked.",
    evidence: "- decision: booked the coast cottage\n- follow-up: pack the tide table",
  });
  const both = await readFile(box.path(CARD), "utf8");
  await t.checkText(both.includes("Planning a coast trip, now booked.") && both.includes("tide table"), "true");
});

// ## Writing evidence never moves the contains basis
//
// The staleness sidecar decides whether a card's `contains` still describes its
// content, by hashing a "basis". `contains-evidence` is derived *alongside*
// `contains`, so it is excluded from that basis — otherwise every pass that
// extended the evidence would flag the summary it was just written with as out of
// date.
//
// Note the basis reaches frontmatter only for a card with **no body text**: a
// card with body text hashes its body. So for chat husks this exclusion is policy
// rather than a live bug, and the cases that need it are the frontmatter-only
// ones.
void test("The staleness sidecar decides whether a card's contains still describes its c...", async (t) => {
  // doctest:L104
  // Real schemas: `doc` has a body field, `file` is frontmatter-only.
  const cardSchemas = await createCardSchemaMap();
  const docSchema = cardSchemas.get("doc");
  const fileSchema = cardSchemas.get("file");
  invariant(docSchema && fileSchema, "doc and file schemas are registered");
  const bodied = (fields: Record<string, unknown>): LoadedCard => ({
    kind: "frontmatter",
    path: "Trip.doc.card",
    schema: docSchema,
    fields: { body: "Body text.", ...fields },
  });
  const flat = (fields: Record<string, unknown>): LoadedCard => ({
    kind: "frontmatter",
    path: "Trip.file.card",
    schema: fileSchema,
    fields,
  });

  // doctest:L122
  await t.checkText(
    // Bodied card: frontmatter is not in the basis at all.
    computeContainsBasis({ card: bodied({ contains: "A trip." }) })
      === computeContainsBasis({ card: bodied({ contains: "A trip.", "contains-evidence": "- learned: trains" }) }),
    "true",
  );

  // doctest:L127
  await t.checkText(
    // Frontmatter-only card: the exclusion is what keeps the basis stable.
    computeContainsBasis({ card: flat({ source: "voice", contains: "A trip." }) })
      === computeContainsBasis({ card: flat({ source: "voice", contains: "A trip.", "contains-evidence": "- learned: trains" }) }),
    "true",
  );

  // A field that is *not* excluded still moves the basis, so the check above is
  // testing the exclusion rather than a basis that ignores everything. (`status` is
  // itself basis-excluded, so it makes a poor control — use a content field.)

  // doctest:L138
  await t.checkText(
    computeContainsBasis({ card: flat({ source: "voice" }) })
      === computeContainsBasis({ card: flat({ source: "email" }) }),
    "false",
  );

  // A bodied card whose body is empty hashes its fields instead, like a
  // bodiless card. A person card with no notes keeps its facts in frontmatter, so
  // an edit there must move the basis (issue
  // `2026-10-11-contains-never-stale-for-bodied-card-with-empty-body`). Whitespace
  // counts as empty.

  // doctest:L150
  const emptyBodied = (fields: Record<string, unknown>): LoadedCard => ({
    kind: "frontmatter",
    path: "Person.doc.card",
    schema: docSchema,
    fields: { body: "\n", ...fields },
  });
  await t.checkText(
    computeContainsBasis({ card: emptyBodied({ phone: "555-0100" }) })
      === computeContainsBasis({ card: emptyBodied({ phone: "555-0199" }) }),
    "false",
  );

  // doctest:L160
  await t.checkText(
    computeContainsBasis({ card: emptyBodied({ phone: "555-0100", contains: "Idris." }) })
      === computeContainsBasis({ card: emptyBodied({ phone: "555-0100", contains: "Idris.", "contains-evidence": "- met at the market" }) }),
    "true",
  );
});

// ## The one-sentence budget applies to `contains` only
//
// An evidence field is *expected* to be long, so the lint budget stays scoped to
// the summary.
void test("An evidence field is expected to be long, so the lint budget stays scoped to...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L171
  const box = await makeTmpBox();
  const longText = "x".repeat(400);

  // doctest:L174
  await box.write(CARD, doc(`contains: ${longText}`));
  const ctx = await buildLoadContext(box.root);
  const overLong = await lintCardsDispatch([box.path(CARD)], { boxRoot: box.root, ctx });
  t.check(overLong.results[0]?.warnings.filter((i) => i.type === "contains").length, 1);

  // The same length in `contains-evidence`, with a short `contains`, is clean.

  // doctest:L184
  await box.write(CARD, doc(`contains: A trip.\ncontains-evidence: ${longText}`));
  const evidenceLong = await lintCardsDispatch([box.path(CARD)], { boxRoot: box.root, ctx });
  t.check(evidenceLong.results[0]?.warnings.filter((i) => i.type === "contains").length, 0);
});
