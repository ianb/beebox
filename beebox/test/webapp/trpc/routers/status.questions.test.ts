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
import "@ianbicking/tap-check/tap";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { statusRouter } from "../../../../src/webapp/trpc/routers/status.js";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

function contextFor(box: TmpBox) {
  const ctx: TrpcContext = trpcContext({ boxRoot: box.root, boxSlug: "t", isAuthenticatedOwner: true });
  return statusRouter.createCaller(ctx);
}


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
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/questions/Receipt.question.card", VALID);
  await box.write("_bookkeeping/questions/Broken.question.card", MALFORMED);

  const caller = contextFor(box);
  const { items } = await caller.questions();

  const dir = "_bookkeeping/questions";
  t.check(items, [
    {
      path: `${box.root}/${dir}/Broken.question.card`,
      relativePath: `${dir}/Broken.question.card`,
      name: "Broken",
      type: "question",
      subdir: undefined,
      state: undefined,
      invalid: true,
    },
    {
      path: `${box.root}/${dir}/Receipt.question.card`,
      relativePath: `${dir}/Receipt.question.card`,
      name: "Receipt",
      type: "question",
      subdir: undefined,
      state: "pending",
      prompt: "Where does this receipt go?",
      memo: undefined,
      inputType: "text",
      options: undefined,
      learning: undefined,
      answer: undefined,
      askedAt: undefined,
    },
  ]);

  // The malformed card keeps its `CardInfo` fields (path, name, type) — enough
  // for a caller to link to it — even though none of the typed question fields
  // resolved:

});
