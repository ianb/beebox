// # `bbx engine intentions check`
//
// The precheck lists a place when it was never reviewed, when a commit
// touched it after its last review (its landmark included), or when its
// intention's prime card is gone. A review record closes the gate whether or
// not the agent edited anything.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { rm } from "node:fs/promises";
import { checkIntentions } from "../../../src/core/intention-review/check/core.js";
import { DRAFT, GARDEN, PLAN, ROOT, WRITING, commit, head, landmark, placesBox, reviewAll } from "./fixture.js";

const STATE = ".beebox/intentions/reviewed.json";

function listedOf(result: Awaited<ReturnType<typeof checkIntentions>>): Array<{ landmark: string; reason: string; changed: string[] }> {
  return result.kind === "nothing" ? [] : result.listed.map((l) => ({ landmark: l.place.landmark, reason: l.reason, changed: l.changed }));
}

// ## Every never-reviewed place is listed, and the run is saved
void test("every never-reviewed place is listed", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await box.write("_bookkeeping/questions/Beans.question.card",
    `---\nprompt: Which beans?\nasked-at: 2026-11-01T09:00:00-07:00\ninput:\n  type: text\ncontext:\n  - ref: /${PLAN}\n---\n`);
  commit(box, { message: "question" });

  const result = await checkIntentions(box.root);
  t.check(listedOf(result), [
    { landmark: ROOT, reason: "never reviewed", changed: [] },
    { landmark: GARDEN, reason: "never reviewed", changed: [] },
    { landmark: WRITING, reason: "never reviewed", changed: [] },
  ]);
  t.check(JSON.parse(await box.read(STATE)), { reviewed: {}, run: { baseline: head(box), listed: [ROOT, GARDEN, WRITING] } });

  // The garden's section carries its landmark, its todo, the question about
  // its plan, and the plan as a recently changed card.
  const brief = result.kind === "review" ? result.brief : "";
  const garden = brief.slice(brief.indexOf(`## ${GARDEN}`), brief.indexOf(`## ${WRITING}`));
  t.check(garden, any(String)
    .matches(/label: Garden\nkept-by: hand\n---\nWhere things stand in Garden\./)
    .matches(/### Open todos\n\n- _content\/garden\/Plan\.doc\.card:4: Water the beans/)
    .matches(/### Questions about cards here\n\n- _bookkeeping\/questions\/Beans\.question\.card: Which beans\?/)
    .matches(/### Most recently changed cards\n\n- _content\/garden\/Plan\.doc\.card: Bean plan\n\n/));
  // The root place stops at the nested places: their cards are not its own.
  const root = brief.slice(brief.indexOf(`## ${ROOT}`), brief.indexOf(`## ${GARDEN}`));
  t.check(root, any(String).matches(/### Open todos\n\n\(none\)/).matches(/### Most recently changed cards\n\n\(none\)/));
});

// ## A reviewed place with no later commits is not listed; a no-change run still records the review
void test("a no-change run records the review and closes the gate", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await reviewAll(box);
  const at = head(box);
  t.check(JSON.parse(await box.read(STATE)), { reviewed: { [ROOT]: at, [GARDEN]: at, [WRITING]: at } });
  t.check(await checkIntentions(box.root), { kind: "nothing" });
});

// ## A later commit to a card lists its place only
void test("a later commit to a card lists its place", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await reviewAll(box);
  await box.write(PLAN, "---\ntitle: Bean plan\n---\nWatered.\n");
  commit(box, { message: "water" });
  t.check(listedOf(await checkIntentions(box.root)), [{ landmark: GARDEN, reason: "changed since its last review", changed: [PLAN] }]);
});

// ## A later commit to the landmark alone lists its place
void test("a later commit to the landmark alone lists its place", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await reviewAll(box);
  await box.write(WRITING, landmark("Writing", "").replace("Where things stand", "Now"));
  commit(box, { message: "summary" });
  t.check(listedOf(await checkIntentions(box.root)), [{ landmark: WRITING, reason: "changed since its last review", changed: [WRITING] }]);
});

// ## A landmark and its cards committed together list nothing after review
void test("a place created in one commit lists nothing after its review", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await reviewAll(box);
  await box.write("_content/loans/Loans.landmark.card", landmark("Loans", ""));
  await box.write("_content/loans/Ledger.doc.card", "Who has what.\n");
  commit(box, { message: "loans place" });
  t.check(listedOf(await checkIntentions(box.root)), [{ landmark: "_content/loans/Loans.landmark.card", reason: "never reviewed", changed: [] }]);
  await reviewAll(box);
  t.check(await checkIntentions(box.root), { kind: "nothing" });
});

// ## A place whose prime card is gone is listed
void test("a place whose intention's card is gone is listed", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await box.write(GARDEN, landmark("Garden", `intention:\n  text: Finish the post\n  ref: /${DRAFT}\n`));
  commit(box, { message: "intention" });
  await reviewAll(box);
  await rm(box.path(DRAFT));
  commit(box, { message: "drop draft" });
  t.check(listedOf(await checkIntentions(box.root)), [
    { landmark: GARDEN, reason: "its intention's card is gone", changed: [] },
    { landmark: WRITING, reason: "changed since its last review", changed: [DRAFT] },
  ]);
});
