// What draws a card in the conversation strip: a box view bound for the
// strip wins over any built-in renderer; else the highest-priority built-in
// renderer that declares `strip: true`; else nothing, and the strip shows
// its one-line notice.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { stripRendererChoice, type StripChoice } from "../../../src/components/FileView/strip-choice.js";
import type { FileRenderer } from "../../../src/file-type-registry.js";

const Component = (): null => null;
const card: FileRenderer = { name: "Card", Component, priority: 30 };
const tour: FileRenderer = { name: "Tour", Component, priority: 100, strip: true };
interface View { slug: string }
const view: View = { slug: "tour-strip" };

function summary(choice: StripChoice<View>): string {
  switch (choice.kind) {
    case "view": return `view ${choice.binding.slug}`;
    case "builtin": return `builtin ${choice.renderer.name}`;
    case "none": return "none";
  }
}

void test("a strip view wins, then a strip-capable built-in, then nothing", async (t) => {
  t.check([
    summary(stripRendererChoice({ binding: view, renderers: [tour, card] })),
    summary(stripRendererChoice<View>({ binding: null, renderers: [tour, card] })),
    summary(stripRendererChoice<View>({ binding: null, renderers: [card] })),
    summary(stripRendererChoice<View>({ binding: null, renderers: [] })),
  ], [
    "view tour-strip",
    "builtin Tour",
    "none",
    "none",
  ]);
});
