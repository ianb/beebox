// # Agent guide — the linter
//
// Plan: `docs/implemented-plans/agent-guide-spec.md`, Track 2. The guide's prose is
// `src/core/agent-guide/guide.md`; the renderer fills its placeholders and strips
// its comments in one pass, and `lintGuide` (`src/core/agent-guide/lint.ts`,
// also `pnpm lint:guide`) checks the result against `ledger.yaml`: cited ids are
// rows, `law` and `core` rows are cited, uncited words per covered section stay
// within the allowance, no comment leaks, the DOCID line survives, and the
// budget holds.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { generateDocs } from "../../../src/core/docs-gen/generate/core.js";
import { BOX_PACKAGE_DOCS, DOCS_DIR } from "../../../src/core/docs-gen/shared.js";
import { lintBoxGuide } from "../../../src/dev/lib/guide-lint-box.js";
import { lintGuide } from "../../../src/core/agent-guide/lint.js";
import { parseLedger } from "../../../src/core/agent-guide/ledger-schema.js";
import { GUIDE_SOURCE_PATH, generateAgentGuide } from "../../../src/core/agent-guide/guide/core.js";
import { renderGuideLines, strippedText, annotatedText } from "../../../src/core/agent-guide/render.js";
import { createInitialGuideTemplate } from "../../../src/schemas/guide/templates.js";

// A three-row ledger with one covered section, for the failure cases below.
const tinyLedger = parseLedger(`
budget: { guide_words: 200, always_loaded_words: 1000, uncited_words_per_section: 5 }
lint: { covered_sections: [ALPHA] }
registry:
  - { handle: ALPHA, governs: the first section, referrers: [] }
  - { handle: BETA, governs: the second section, referrers: [] }
rows:
  - { id: alpha.one, rule: One., handle: ALPHA, bin: core, reason: Test., audits: [] }
  - { id: alpha.two, rule: Two., handle: ALPHA, bin: law, reason: Test., audits: [] }
  - { id: beta.one, rule: Three., handle: BETA, bin: core, reason: Test., audits: [] }
`);

// The failures for `source`, one per line.
function tinyLint(source: string): string {
  const lines = renderGuideLines({ source, fillers: { list: () => "- a\n- b" } });
  return lintGuide({ ledger: tinyLedger, lines, checkBudget: true }).failures.join("\n");
}

// ## The shipped guide passes on a bare box, within budget
//
// A box as `bbx init` leaves it: stock procedures, guides, and personality.
// The budget is asserted here.
void test("A box as bbx init leaves it:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L51
  const box = await makeTmpBox();
  await generateDocs(box.root, { force: true, commit: false });
  const report = await lintBoxGuide(box.root, { checkBudget: true });
  t.check(report.failures, []);

  // doctest:L57
  t.check(report.uncitedWords["THE_LAWS"], 0);
});

// ## A rich box renders its own content and still lints clean
//
// A box-local schema, an extra guide card, an extra procedure, and an edited
// personality card. The generated parts are cited through their placeholders'
// annotations, so per-box content adds no uncited words. The budget is
// reported, not asserted: a real box's size depends on its content.
void test("A box-local schema, an extra guide card, an extra procedure, and an edited pe...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L73
  const box = await makeTmpBox({ deps: true });
  await box.write("src/schemas/widget.ts", `import { cardSchema } from "beebox/cards";
import { z } from "beebox/schema";

export default cardSchema("widget", {
  description: "A widget the boxholder tracks",
  category: "authored",
  fields: { size: z.number() },
  instructions: "How to widget.",
});
`);
  await box.write("_config/cooking.guide.card", createInitialGuideTemplate({ name: "cooking" }));
  await box.write("_config/procedures/extra.procedure.card", "---\nname: extra\ndescription: An extra procedure for the fixture.\n---\nDo the extra thing.\n");
  // The first sync installs the stock personality card, which the fixture then edits.
  await generateDocs(box.root, { force: true, commit: false });
  const personality = await box.read("_config/main.personality.card");
  await box.write("_config/main.personality.card", personality.replace("goes-by: Egg", "goes-by: Wren"));
  await generateDocs(box.root, { force: true, commit: false });

  const report = await lintBoxGuide(box.root, { checkBudget: false });
  // doctest:L92
  t.check(report.failures, []);

  // doctest:L96
  const rendered = await box.read(".beebox/agent-guide.md");
  // The rendered guide is a large generated text; each fixture line is checked inside it.
  for (const line of ["- **widget** — A widget the boxholder tracks", "- **cooking**", "- **extra** — An extra procedure for the fixture.", "You are **Wren**."]) {
    t.check(rendered, any(String).includes(line));
  }

  // doctest:L100
  t.check({ guideWords: report.guideWords, alwaysLoadedWords: report.alwaysLoadedWords, uncitedLaws: report.uncitedWords["THE_LAWS"] }, {
    guideWords: any(Number).int(),
    alwaysLoadedWords: any(Number).int(),
    uncitedLaws: 0,
  });
});

// ## The source's package paths match the engine's constants
//
// `guide.md` spells the package-docs and compiled-docs directories out; if the
// constants move, the guide's paths must move with them.
void test("guide.md spells the package-docs and compiled-docs directories out; if the co...", async (t) => {
  // doctest:L116
  const source = await fs.readFile(GUIDE_SOURCE_PATH, "utf-8");
  // guide.md is a large source text; the narrow check is whether it spells each directory.
  t.check(source, any(String).includes(`${BOX_PACKAGE_DOCS}/`));
  t.check(source, any(String).includes(`${DOCS_DIR}/`));
  t.check(path.relative(PACKAGE_ROOT, GUIDE_SOURCE_PATH), "src/core/agent-guide/guide.md");
});

// ## Stripping drops the header and citations and keeps the text
//
// The header comment and each `rules` line are gone from the stripped form and
// kept in the annotated one; a line-level placeholder takes the filler's lines.
void test("The header comment and each rules line are gone from the stripped form and ke...", async (t) => {
  // doctest:L127
  const source = "<!--\nheader\n-->\n# Title\n\n## ALPHA — First\n\n<!-- rules: alpha.one -->\nText.\n{{list}}\n";
  const lines = renderGuideLines({ source, fillers: { list: () => "- a\n- b" } });
  await t.checkText(strippedText(lines), `# Title
«blankline»
## ALPHA — First
«blankline»
Text.
- a
- b`);

  // doctest:L138
  t.check(annotatedText(lines).split("\n").filter((l) => l.startsWith("<!--")), ["<!--", "<!-- rules: alpha.one -->"]);
});

// ## A fenced example is one passage, and a rules line inside it is text
//
// A blank line inside a fence does not end the citation (a blank line before
// the fence still would, so the annotation sits directly above the passage
// that holds the fence), a `##` line inside a fence is not a heading, and a
// line that looks like a rules comment is kept as example text rather than
// stripped.
void test("A blank line inside a fence does not end the citation (a blank line before th...", async (t) => {
  // doctest:L151
  const fenced = "# T\n\n## ALPHA\n\n<!-- rules: alpha.ex -->\nExample:\n~~~\nfirst\n\n<!-- rules: shown -->\n## not a heading\nlast\n~~~\n";
  const fencedLines = renderGuideLines({ source: fenced, fillers: {} });
  t.check(fencedLines.filter((l) => !l.comment && l.text !== "").map((l) => ({ section: l.section, rules: l.rules, text: l.text })), [
    { section: null, rules: [], text: "# T" },
    { section: "ALPHA", rules: [], text: "## ALPHA" },
    { section: "ALPHA", rules: ["alpha.ex"], text: "Example:" },
    { section: "ALPHA", rules: ["alpha.ex"], text: "~~~" },
    { section: "ALPHA", rules: ["alpha.ex"], text: "first" },
    { section: "ALPHA", rules: ["alpha.ex"], text: "<!-- rules: shown -->" },
    { section: "ALPHA", rules: ["alpha.ex"], text: "## not a heading" },
    { section: "ALPHA", rules: ["alpha.ex"], text: "last" },
    { section: "ALPHA", rules: ["alpha.ex"], text: "~~~" },
  ]);
});

// ## A null filler omits its section; an empty one leaves no gap
void test("A null filler omits its section; an empty one leaves no gap", async (t) => {
  // doctest:L160
  const source = "# T\n\n## ALPHA\n\nIntro.\n\n{{empty}}\n\nAfter.\n\n## BETA\n\n{{gone}}\n\n## GAMMA\n\nEnd.\n";
  await t.checkText(strippedText(renderGuideLines({ source, fillers: { empty: () => "", gone: () => null } })), `# T
«blankline»
## ALPHA
«blankline»
Intro.
«blankline»
After.
«blankline»
## GAMMA
«blankline»
End.`);
});

// ## Failures name the section, the row, or the leaked line
void test("Failures name the section, the row, or the leaked line", async (t) => {
  // doctest:L178
  t.check(tinyLint("## ALPHA\n\n<!-- rules: alpha.one, alpha.two -->\nCited text.\n\n## BETA\n\nFree text in an uncovered section is fine.\n"), "");

  // doctest:L181
  t.check(tinyLint("## ALPHA\n\n<!-- rules: alpha.one, alpha.two, alpha.three -->\nCited.\n"), "ALPHA: cites \"alpha.three\", which is not a row in ledger.yaml");

  // doctest:L184
  t.check(tinyLint("## ALPHA\n\n<!-- rules: alpha.one -->\nCited.\n"), "ALPHA: row \"alpha.two\" (law) is not cited in guide.md");

  // doctest:L187
  t.check(tinyLint("## ALPHA\n\n<!-- rules: alpha.one, alpha.two -->\nCited.\n\nThis paragraph carries no citation at all.\n"), "ALPHA: 7 uncited words (allowance 5); largest uncited passage starts \"This paragraph carries no citation at all.\"");

  // doctest:L190
  t.check(tinyLint("## ALPHA\n\n<!-- rules: alpha.one, alpha.two -->\nCited.\n<!-- rule: alpha.one -->\n"), "comment leaked into the render: <!-- rule: alpha.one -->");

  // doctest:L193
  t.check(tinyLint(`## ALPHA\n\n<!-- rules: alpha.one, alpha.two -->\n${"word ".repeat(250)}\n`), "the rendered guide is 261 words, over budget.guide_words 200");
});

// ## The renderer and `generateAgentGuide` agree
//
// `generateAgentGuide` is the stripped render of the shipped `guide.md`.
void test("generateAgentGuide is the stripped render of the shipped guide.md.", async (t) => {
  // doctest:L202
  const guide = generateAgentGuide({ procedures: [], shape: { shapeVersion: 3, boxRoot: "/tmp/box" }, instructionFile: "AGENTS.md" });
  // The guide is a large generated text; the narrow checks are its title and no leftover markup.
  t.check(guide, any(String).startsWith("# Bee Box Agent Guide\n"));
  t.check(guide, not(any(String).includes("<!--")));
  t.check(guide, not(any(String).includes("{{")));
});
