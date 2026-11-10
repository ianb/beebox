// # `bbx engine intentions verify`
//
// The validate judges only commits carrying `Created-By: refresh-intentions`:
// each may change the `intention` of a listed landmark and nothing else (the
// raw frontmatter, unknown keys included, and the body are compared). Other
// commits during the run are not judged. Plan: docs/plans/place-intention.md,
// Track D.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { checkIntentions } from "../../../src/core/intention-review/check/core.js";
import { verifyIntentions } from "../../../src/core/intention-review/verify/core.js";
import { DRAFT, GARDEN, PLAN, PROCEDURE_MESSAGE, ROOT, WRITING, commit, head, landmark, placesBox } from "./fixture.js";

const STATE = ".beebox/intentions/reviewed.json";
const INTENTION = "intention:\n  text: Water the beans\n";

// ## An intention-only commit passes and records every listed place at HEAD
void test("an intention-only procedure commit passes", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await checkIntentions(box.root);
  await box.write(GARDEN, landmark("Garden", INTENTION));
  commit(box, { message: PROCEDURE_MESSAGE, paths: [GARDEN] });

  t.check(await verifyIntentions(box.root), { ok: true, reviewed: [ROOT, GARDEN, WRITING] });
  const at = head(box);
  t.check(JSON.parse(await box.read(STATE)), { reviewed: { [ROOT]: at, [GARDEN]: at, [WRITING]: at } });
  t.check(await checkIntentions(box.root), { kind: "nothing" });
});

// ## A procedure commit that edits another card fails
void test("a procedure commit that edits another card fails", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await checkIntentions(box.root);
  const baseline = head(box);
  await box.write(GARDEN, landmark("Garden", INTENTION));
  await box.write(PLAN, "Rewritten.\n");
  commit(box, { message: PROCEDURE_MESSAGE });

  t.check(await verifyIntentions(box.root), {
    ok: false,
    problems: [any(String).matches(/^commit [\da-f]{8} changed _content\/garden\/Plan\.doc\.card, which is not a listed landmark$/)],
  });
  // The run stays open and nothing is recorded, so the next run retries.
  t.check(JSON.parse(await box.read(STATE)), { reviewed: {}, run: { baseline, listed: [ROOT, GARDEN, WRITING] } });
});

// ## A procedure commit that edits a landmark's body fails
void test("a procedure commit that edits a landmark body fails", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await checkIntentions(box.root);
  await box.write(GARDEN, landmark("Garden", INTENTION).replace("Where things stand", "Now"));
  commit(box, { message: PROCEDURE_MESSAGE });

  t.check(await verifyIntentions(box.root), {
    ok: false,
    problems: [any(String).matches(/^commit [\da-f]{8} changed _content\/garden\/Garden\.landmark\.card outside intention: its body changed$/)],
  });
});

// ## A procedure commit that edits an unknown frontmatter key fails
void test("a procedure commit that edits an unknown frontmatter key fails", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await checkIntentions(box.root);
  await box.write(GARDEN, landmark("Garden", INTENTION).replace("kept-by: hand", "kept-by: agent"));
  commit(box, { message: PROCEDURE_MESSAGE });

  t.check(await verifyIntentions(box.root), {
    ok: false,
    problems: [any(String).matches(/outside intention: frontmatter changed: kept-by$/)],
  });
});

// ## An unrelated commit during the run passes; the place it touched is looked at again
void test("an unrelated non-procedure commit during the run passes", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await checkIntentions(box.root);
  const baseline = head(box);
  await box.write(DRAFT, "---\ntitle: Garden post\n---\nThe trellis, and the gate.\n");
  commit(box, { message: "chat: draft the gate paragraph" });
  await box.write(GARDEN, landmark("Garden", INTENTION));
  commit(box, { message: PROCEDURE_MESSAGE, paths: [GARDEN] });

  t.check(await verifyIntentions(box.root), { ok: true, reviewed: [ROOT, GARDEN, WRITING] });
  const at = head(box);
  // Writing changed under the review, so it is recorded at the baseline.
  t.check(JSON.parse(await box.read(STATE)), { reviewed: { [ROOT]: at, [GARDEN]: at, [WRITING]: baseline } });
});

// ## A listed landmark left modified fails
void test("a listed landmark left uncommitted fails", async (t) => {
  const box = await placesBox();
  t.teardown(() => box.cleanup());
  await checkIntentions(box.root);
  await box.write(GARDEN, landmark("Garden", INTENTION));

  t.check(await verifyIntentions(box.root), { ok: false, problems: [`${GARDEN} has uncommitted changes`] });
});
