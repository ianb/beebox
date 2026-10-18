// # `card.get` returns the body's line offset
//
// A rendered todo is addressed by its line in the card's FILE, not in the body
// the renderer is handed (`shared/todo-locators.ts`). `card.get` returns the
// split body, so it also returns `bodyLineOffset`, the number of file lines
// before that body, from the same `splitCardContent` the collector uses
// (`docs/plans/todos-ui.md`, Track 2).

import { test } from "tap";
import "agent-doctest/tap";
import Markdoc from "@markdoc/markdoc";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { assignLocators } from "../../../../src/shared/todo-locators.js";

// Markdoc ships dual CJS/ESM but its `exports` field is null, so Node ESM
// imports resolve to the CJS bundle — which only exposes a default export.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse } = Markdoc;

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

// A doc with a three-field frontmatter block: five lines precede the body.
void test("A doc with a three-field frontmatter block:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L26
  const box = await makeTmpBox({ git: true });
  await box.write("_content/Porch.doc.card", [
    "---",
    "title: Porch",
    "via: {channel: telegram}",
    "sources: []",
    "---",
    "Intro line.",
    "",
    "{% todo %}Order lumber{% /todo %}",
    "",
  ].join("\n"));
  box.commitAll("seed");

  // doctest:L40
  const card = await caller(box.root).card.get({ path: "_content/Porch.doc.card" });
  t.check(card.bodyLineOffset, 5);

  // Numbering the returned body with that offset gives the collector's locator:

  // doctest:L48
  t.check([...assignLocators(parse(card.body ?? ""), card.bodyLineOffset).values()], [
    {
      kind: "body",
      line: 8,
    },
  ]);

  // doctest:L51
  const res = await caller(box.root).collections.query({
    collection: "todos",
    query: { here: "_content/Porch.doc.card", includeReferring: false, params: { status: ["open"] } },
  });
  t.check(res.groups.flatMap((g) => g.rows.flatMap((r) => r.items.map((i) => i.locator))), [
    {
      kind: "body",
      line: 8,
    },
  ]);

  // A card whose frontmatter does not validate still reports the offset, since
  // its body is still shown:

  // doctest:L63
  await box.write("_content/Broken.doc.card", "---\ntitle: [not, a, title]\n---\nBody\n");
  const broken = await caller(box.root).card.get({ path: "_content/Broken.doc.card" });
  t.check([broken.validationError === undefined, broken.bodyLineOffset, broken.body], [
    false,
    3,
    `Body
`,
  ]);
});
