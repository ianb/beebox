// # Courseware plugin: the concept-map view
//
// `src/plugins/courseware/view.tsx` is the view a box gives its `concept-map`
// cards. The box does not import it directly: a stub at `src/views/concept-map.tsx`
// re-exports the plugin view as its default and declares the view metadata
// (`rendersCardTypes`, a `dependencies` glob that selects concept-map cards). The
// host sets `params.path` to the card being displayed; the view finds that card in
// `cards` and renders its body through the `Markdown` widget, then the graph.
//
// This renders the built plugin view the way `bbx view check` does after its
// compile step: `dist/plugins/courseware/view.js` is built by the real plugin
// build step and imported through the package `exports` map, given the cards the
// real loader selects, and rendered to a string inside `NodeViewHostProvider`.
// The stub-to-render path through the view compiler is
// `test/webapp/views/compiler.plugin-view.test.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";
import { buildPluginBundlesIntoDist } from "../../helpers/plugin-bundles.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { buildProps } from "../../../src/cli/commands/view/command.js";
import { loadViewCards } from "../../../src/core/views/cards.js";
import { parseConcepts } from "../../../src/plugins/courseware/view/concept-data.js";
import { buildGraph } from "../../../src/plugins/courseware/view/graph/model.js";

// The bundle's `react`/`react-dom` imports resolve to this process's copies,
// the same instance `react-dom/server` renders with.
await buildPluginBundlesIntoDist();
const view = await import("beebox/plugins/courseware/view");
const { NodeViewHostProvider } = await import("beebox/view-widgets");

// A box activates the plugin by naming it in `_config/box.json` and writing the
// stubs its README lists (docs/plugins.md): the schema stub makes `concept-map`
// a card type the loader recognizes; the view stub is the view under test.
const SCHEMA_STUB = `import { cardSchema } from "beebox/cards";
import courseware from "beebox/plugins/courseware";
export default cardSchema("concept-map", courseware.schemas["concept-map"]);
`;
async function activateCourseware(box: TmpBox) {
  await box.write("_config/box.json", JSON.stringify({ plugins: ["courseware"] }, null, 2) + "\n");
  await mkdir(join(box.root, "src", "schemas"), { recursive: true });
  await writeFile(join(box.root, "src", "schemas", "concept-map.ts"), SCHEMA_STUB);
}

// What `bbx view check` does after compiling: build the props from the real
// card loader, render inside the node view host.
async function renderConceptMap(box: TmpBox, params: Record<string, string>) {
  const { cards, files } = await loadViewCards(box.root, ["**/*.concept-map.card"]);
  const props = buildProps({ cards, files, params, boxSlug: "test" });
  return renderToString(createElement(NodeViewHostProvider, { boxSlug: "test", children: createElement(view.default, props) }));
}

const CARD_PATH = "_content/courses/Fractions.concept-map.card";
const FRACTIONS_CARD = `---
concepts:
  - id: part-whole
    name: Part-whole meaning
    kind: concept
    gloss: A fraction names equal parts of a whole.
    related:
      - to: equivalence
        kind: prerequisite
  - id: equivalence
    name: Equivalent fractions
    kind: principle
    misconceptions:
      - Multiplying the numerator alone keeps the value.
    related:
      - to: adding
        kind: prerequisite
  - id: adding
    name: Adding unlike denominators
    kind: procedure
---
Fractions name parts of a whole; this map orders what to learn first.
`;

// ## The pure pieces
//
// `parseConcepts` reads the card's `concepts` frontmatter into typed nodes,
// skipping entries without an id and name and defaulting an unknown kind:
void test("parseConcepts reads the card's concepts frontmatter into typed nodes, skippin...", async (t) => {
  const parsed = parseConcepts([
    { id: "a", name: "A", kind: "principle", related: [{ to: "b", kind: "prerequisite" }, { to: "zz", kind: "nonsense" }] },
    { id: "b", name: "B", kind: "weird" },
    { name: "no id" },
  ]);
  t.check(parsed, [
    { id: "a", name: "A", kind: "principle", gloss: null, depth: null, misconceptions: [], related: [{ to: "b", kind: "prerequisite" }] },
    { id: "b", name: "B", kind: "concept", gloss: null, depth: null, misconceptions: [], related: [] },
  ]);

  // `buildGraph` lays the nodes out top-down with dagre; a prerequisite's target
  // sits below its source, and an edge to an unknown id is dropped (card-lint
  // reports it):

  const { nodes, edges } = buildGraph(parsed);
  const a = nodes.find((n) => n.id === "a");
  const b = nodes.find((n) => n.id === "b");
  t.check(edges, [
    {
      id: "a__prerequisite__b",
      source: "a",
      target: "b",
      className: "bbx-cm-edge-prerequisite",
      style: { stroke: "currentColor", strokeWidth: 1.5 },
    },
  ]);
  t.check(a?.data.concept, parsed[0]);
  t.check(b?.position.y, any(Number).above(a?.position.y ?? 0));
});

// ## Rendering the built view
//
// The rendered page has the intro prose (through `Markdown`) and every concept's
// name. `params.path` names the card the way a card page does, and the view
// finds it in `cards`:
void test("The rendered page has the intro prose (through Markdown) and every concept's...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ deps: true, git: true });
  await activateCourseware(box);
  await box.write(CARD_PATH, FRACTIONS_CARD);

  const html = await renderConceptMap(box, { path: CARD_PATH });
  // The page is generated HTML, so each check keeps the one fragment it names.
  t.check(html, any(String).includes("this map orders what to learn first"));
  t.check(html, any(String).includes("Part-whole meaning"));
  t.check(html, any(String).includes("Equivalent fractions"));
  t.check(html, any(String).includes("Adding unlike denominators"));

  // The misconception count shows on its node, and the legend is present:

  t.check(html, any(String).includes("1 common misconception"));
  t.check(html, any(String).includes("Concept kinds"));

  // Without `params.path` the view has no anchor card and says so instead of
  // rendering an empty graph:

  const bare = await renderConceptMap(box, {});
  t.check(bare, any(String).includes("This concept-map card is not available."));
});
