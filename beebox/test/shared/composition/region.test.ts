// # Finding and splicing a doc card's composition region
//
// `findComposition` locates the text strictly between the `{% composition %}`
// line and the `{% /composition %}` line, or names why there is no usable
// region. `spliceComposition` replaces that text and keeps every byte outside it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { findComposition, spliceComposition, type CompositionRegion } from "../../../src/shared/composition/region.js";

const BODY = "Notes before.\n\n{% composition %}\nFirst paragraph.\n\nSecond paragraph.\n{% /composition %}\n\n## Revision notes\n\n- tighten the ending\n";

function region(body: string): CompositionRegion {
  const found = findComposition(body);
  if ("problem" in found) throw new Error(`expected a region, got ${found.problem}`);
  return found;
}

// ## One region: offsets cover whole lines; text drops the final newline
void test("one region", async (t) => {
  const found = region(BODY);
  t.check(found, { textStart: 33, textEnd: 69, text: "First paragraph.\n\nSecond paragraph." });
  t.check(BODY.slice(found.textStart, found.textEnd), "First paragraph.\n\nSecond paragraph.\n");
});

// ## An empty composition is a region with empty text
void test("empty region", async (t) => {
  t.check(findComposition("{% composition %}\n{% /composition %}\n"), { textStart: 18, textEnd: 18, text: "" });
});

// ## No region
void test("no region", async (t) => {
  t.check(findComposition("Just notes.\n"), { problem: "none" });
  // Markdoc processes tags inside a fence unless the fence sets `process=false`.
  t.check(findComposition("```{% process=false %}\n{% composition %}\nx\n{% /composition %}\n```\n"), { problem: "none" });
});

// ## Problems: two regions, an inline tag, a missing or swallowed closer
void test("problems", async (t) => {
  t.check(findComposition(`${BODY}\n{% composition %}\nMore.\n{% /composition %}\n`), { problem: "multiple" });
  t.check(findComposition("Text {% composition %}x{% /composition %} more.\n"), { problem: "inline" });
  // Text on the opening line makes the tag inline; the lone closer is not a second region.
  t.check(findComposition("{% composition %}First line\nmore\n{% /composition %}\n"), { problem: "inline" });
  t.check(findComposition("{% composition %}\nNo closer.\n"), { problem: "unclosed" });
  // An unclosed mark inside swallows the composition's closer.
  t.check(
    findComposition('{% composition %}\nText.\n\n{% editorial kind="note" %}\nOpen note.\n{% /composition %}\n'),
    { problem: "unclosed" },
  );
});

// ## Splice replaces only the region
void test("splice keeps the bytes outside the region", async (t) => {
  const found = region(BODY);
  const spliced = spliceComposition(BODY, { region: found, text: "A new draft." });
  t.check(spliced, "Notes before.\n\n{% composition %}\nA new draft.\n{% /composition %}\n\n## Revision notes\n\n- tighten the ending\n");
  t.check(spliced.slice(0, found.textStart), BODY.slice(0, found.textStart));
  t.check(spliced.slice(found.textStart + "A new draft.\n".length), BODY.slice(found.textEnd));
  // The region's own text splices back to the same body.
  t.check(spliceComposition(BODY, { region: found, text: found.text }), BODY);
  // Text into an empty region, and an emptied region, both keep the closer on its own line.
  const empty = "{% composition %}\n{% /composition %}\n";
  t.check(spliceComposition(empty, { region: region(empty), text: "Start." }), "{% composition %}\nStart.\n{% /composition %}\n");
  t.check(spliceComposition(BODY, { region: found, text: "" }), "Notes before.\n\n{% composition %}\n{% /composition %}\n\n## Revision notes\n\n- tighten the ending\n");
});
