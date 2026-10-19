// # Type-checking views against ViewProps
//
// `typecheckViews(boxRoot)` statically checks each view's default export against the
// real `ViewProps`/`ViewCard` — catching removed/renamed field use that compiles
// and renders fine but is silently wrong (e.g. `c.tagName` after the card-shape
// cleanup), which the render gate (`bbx view check`) can't see.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Expected, unordered } from "@ianbicking/tap-check/check";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { typecheckViews, type ViewTypecheckResult } from "../../../../src/cli/commands/view/typecheck.js";

// Views live at `<boxRoot>/src/views`.
async function writeView(box: TmpBox, { rel, content }: { rel: string; content: string }) {
  const full = join(box.root, "src", "views", rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

const HEAD = `export const name = "x";
export const description = "x";
export const dependencies = [];
export const modes = ["page"];
`;

// Stale local type declaring a removed field (the todos.tsx-before-migration
// shape): the real ViewCard has no `tagName`, so the export can't satisfy
// ComponentType<ViewProps>.
const STALE = HEAD + `type VC = { path: string; tagName: string };
export default function V({ cards }: { cards: VC[] }) {
  return <ul>{cards.map((c) => <li key={c.path}>{c.tagName}</li>)}</ul>;
}
`;

// Migrated: reads the real fields (path, type).
const CLEAN = HEAD + `type VC = { path: string; type: string };
export default function V({ cards }: { cards: VC[] }) {
  return <ul>{cards.map((c) => <li key={c.path}>{c.type}</li>)}</ul>;
}
`;

// `as any` defeats the type system — documented limitation (render/textual
// gates backstop these).
const ANYCAST = HEAD + `export default function V({ cards }: { cards: any[] }) {
  return <ul>{cards.map((c) => <li key={c.path}>{c.tagName}</li>)}</ul>;
}
`;

// An internal type error unrelated to ViewCard (the Float32Array-lib-noise
// class) must NOT be flagged — typecheck scopes to the ViewProps boundary, not
// the whole view body.
const NOISE = HEAD + `type VC = { path: string; type: string };
export default function V({ cards }: { cards: VC[] }) {
  const n: number = "not a number";
  return <ul>{cards.map((c) => <li key={c.path}>{c.type}{n}</li>)}</ul>;
}
`;

// ## A stale-typed view (removed field) fails; clean passes; `as any` slips through
void test("A stale-typed view (removed field) fails; clean passes; `as any` slips through", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L64
  const box = await makeTmpBox({ deps: true });
  await writeView(box, { rel: "stale.tsx", content: STALE });
  await writeView(box, { rel: "clean.tsx", content: CLEAN });
  await writeView(box, { rel: "anycast.tsx", content: ANYCAST });
  await writeView(box, { rel: "noise.tsx", content: NOISE });

  // doctest:L70
  const result = await typecheckViews(box.root);
  t.check(result, {
    ok: false,
    views: unordered<Expected<ViewTypecheckResult>>([
      {
        slug: "stale",
        ok: false,
        errors: [
          `Type '({ cards }: { cards: VC[]; }) => Element' is not assignable to type 'ComponentType<ViewProps>'.
  Type '({ cards }: { cards: VC[]; }) => Element' is not assignable to type 'FunctionComponent<ViewProps>'.
    Types of parameters '__0' and 'props' are incompatible.
      Type 'ViewProps' is not assignable to type '{ cards: VC[]; }'.
        Types of property 'cards' are incompatible.
          Type 'ViewCard[]' is not assignable to type 'VC[]'.
            Property 'tagName' is missing in type 'ViewCard' but required in type 'VC'.`,
        ],
      },
      { slug: "noise", ok: true },
      { slug: "clean", ok: true },
      { slug: "anycast", ok: true },
    ]),
  });
});

// </content>
