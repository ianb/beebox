// The strip-capable built-in types the server accepts
// (`shared/strip-types.ts`, BUILTIN_STRIP_TYPES) each have a registered
// renderer that declares a strip rendering, so a card `bbx chat strip set`
// accepts is a card the page can draw.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { BUILTIN_STRIP_TYPES } from "../../../shared/strip-types.js";
import { getRenderers } from "../../src/file-type-registry.js";
import { installRenderers } from "../../src/renderers.js";

installRenderers();

function stripRenderers(type: string): string[] {
  const path = `_content/example.${type}.card`;
  return getRenderers(path, { path, type, kind: "frontmatter", frontmatter: {}, body: "" })
    .filter((renderer) => renderer.strip === true)
    .map((renderer) => renderer.name);
}

void test("a tour card has a strip renderer", async (t) => {
  t.check(stripRenderers("tour"), ["Tour"]);
});

void test("every built-in strip type has a strip renderer; an ordinary card has none", async (t) => {
  t.check(BUILTIN_STRIP_TYPES.filter((type) => stripRenderers(type).length === 0), []);
  t.check(stripRenderers("doc"), []);
});
