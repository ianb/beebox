// # tRPC `status.questions` — malformed cards stay visible
//
// `status.questions` parses each card in `_bookkeeping/questions/` against
// `QuestionSchema` to attach the typed fields (`prompt`, `input`, `answer`,
// …) on top of the lightweight `CardInfo` the state scan already found. A
// card that fails that parse (bad frontmatter, a lifecycle-coherence
// violation, …) must not vanish from the list — it comes back marked
// `invalid: true` so the frontend can still surface it (as its own small
// section, pointing at the raw file) instead of silently dropping it.

import { test } from "tap";
import "agent-doctest/tap";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { statusRouter } from "../../../../src/webapp/trpc/routers/status.js";
import assert from "node:assert/strict";
import { makeTmpBox, type TmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

function contextFor(box: TmpBox) {
  const ctx: TrpcContext = trpcContext({ boxRoot: box.root, boxSlug: "t", isAuthenticatedOwner: true });
  return statusRouter.createCaller(ctx);
}

// makeTmpBox writes a shapeVersion-3 marker with no version/created;
// status.questions calls getSystemState → getBoxMetadata, which parses those,
// so seed a marker carrying both (keeping shapeVersion 3 for getBoxShape).
const MARKER = JSON.stringify({ shapeVersion: 3, version: "1.0.0", created: "2026-01-01T00:00:00Z" });

const VALID = `---
prompt: Where does this receipt go?
input:
  type: text
directive: File the receipt
---
`;

// Missing the required \`prompt\` field — parses as frontmatter fine (the
// state scan only reads a card's lifecycle fields/type), but fails QuestionSchema
// validation when status.questions loads and re-parses it.
const MALFORMED = `---
input:
  type: text
---
`;

void test("line 46", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L47
  const box = await makeTmpBox({ git: true });
  await box.seed(".beebox/box.json", MARKER);
  await box.write("_bookkeeping/questions/Receipt.question.card", VALID);
  await box.write("_bookkeeping/questions/Broken.question.card", MALFORMED);

  // doctest:L52
  const caller = contextFor(box);
  const { items } = await caller.questions();

  // doctest:L55
  await t.checkText(items.length, "2");

  // doctest:L58
  const good = items.find((i) => i.name === "Receipt");
  assert.ok(good);
  t.check(good.invalid, undefined);

  // doctest:L63
  t.check(good.prompt, "Where does this receipt go?");

  // doctest:L66
  t.check(good.state, "pending");

  // doctest:L69
  const broken = items.find((i) => i.name === "Broken");
  assert.ok(broken);
  t.check(broken.invalid, true);

  // doctest:L74
  t.check(broken.prompt, undefined);

  // The malformed card keeps its `CardInfo` fields (path, name, type) — enough
  // for a caller to link to it — even though none of the typed question fields
  // resolved:

  // doctest:L83
  t.check(broken.relativePath, "_bookkeeping/questions/Broken.question.card");
});
