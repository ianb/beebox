// # validate-markdown: staged markdown + lintable predicate
//
// `bbx validate --staged` lints staged markdown the way it lints staged cards.
// `listStagedMarkdown` collects the staged `.md` files worth linting, and
// `isLintableMarkdown` is the shared skip predicate (`--all` and `--staged` agree).

import { test } from "tap";
import "agent-doctest/tap";
import { str } from "agent-doctest/check";
import { makeTmpBox } from "../helpers/test-helpers.js";
import {
  listStagedMarkdown,
  lintMarkdownFiles,
  boxWideLinkWarnings,
  isLintableMarkdown,
} from "../../src/cli/validate-markdown.js";
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

// A staged dossier with a valid and a broken box-root link is collected, and
// linting it surfaces the one broken link:
void test("A staged dossier with a valid and a broken box-root link is collected, and li...", async (t) => {
  // doctest:L24
  const box = await makeTmpBox({ git: true });
  await mkdir(join(box.root, "_content/images"), { recursive: true });
  await writeFile(join(box.root, "_content/images/a.webp"), "x");

  // doctest:L28
  const doc = join(box.root, "_content/docs/saoirse.md");
  await mkdir(dirname(doc), { recursive: true });
  await writeFile(doc, "![ok](/_content/images/a.webp)\n![broken](/_content/images/missing.webp)\n");
  execSync("git add -A", { cwd: box.root });

  // doctest:L33
  const staged = await listStagedMarkdown(box.root);
  t.check(staged.map((p) => relative(box.root, p)), [
    "_content/docs/saoirse.md",
  ]);

  // doctest:L42
  const summary = await lintMarkdownFiles(staged, { boxRoot: box.root });
  t.check(summary, {
    filesChecked: 1,
    filesWithErrors: 1,
    totalErrors: 1,
    errors: {
      [doc]: [
        {
          lineNumber: 2,
          ruleNames: ["BBX002", "no-broken-internal-links"],
          ruleDescription: "Internal links (relative, or box-root absolute) must point to an existing file or directory inside the box",
          ruleInformation: null,
          errorDetail: "Broken link: /_content/images/missing.webp",
          errorContext: null,
          errorRange: [2, 39],
          fixInfo: null,
          severity: "error",
        },
      ],
    },
  });

  // doctest:L48
  await box.cleanup();
});

// `isLintableMarkdown` accepts box markdown but skips harness instruction files, `.claude/` rule
// docs, and non-markdown:
void test("isLintableMarkdown accepts box markdown but skips harness instruction files,...", async (t) => {
  // doctest:L55
  t.check(isLintableMarkdown("_content/docs/saoirse.md"), true);

  // doctest:L58
  t.check(isLintableMarkdown("CLAUDE.md"), false);

  // doctest:L61
  t.check(isLintableMarkdown("notes/AGENTS.md"), false);

  // doctest:L64
  t.check(isLintableMarkdown("_content/x/.claude/rules/foo.md"), false);

  // doctest:L67
  t.check(isLintableMarkdown("_content/notes.txt"), false);
});

// It also skips bbx's own machine-generated docs — a `docs/generated/` segment pair
// at ANY depth, not just box root (generated trees are nested per-area, e.g.
// `_content/roadtrip/docs/generated/`). A plain `docs/` dir that isn't generated is
// still linted:
void test("It also skips bbx's own machine-generated docs — a docs/generated/ segment pa...", async (t) => {
  // doctest:L77
  t.check(isLintableMarkdown("docs/generated/card-doc.md"), false);

  // doctest:L80
  t.check(isLintableMarkdown("_content/roadtrip/docs/generated/card-email-outbound.md"), false);

  // doctest:L83
  t.check(isLintableMarkdown("_content/handbook/docs/onboarding.md"), true);
});

// `boxWideLinkWarnings` is the warn-only commit-time scan: it finds a broken link
// in any box file (even one that isn't staged — the move-collateral case) and
// returns advisory text, or null when the box is link-clean.
void test("boxWideLinkWarnings is the warn-only commit-time scan:", async (t) => {
  // doctest:L92
  const box3 = await makeTmpBox();
  await mkdir(join(box3.root, "store"), { recursive: true });
  await writeFile(join(box3.root, "_content/note.md"), "![gone](/_content/gone.png)\n");
  const warn = await boxWideLinkWarnings(box3.root);
  await box3.cleanup();
  t.check(warn, str`error  ${box3.root}/_content/note.md:1  [BBX002] Internal links (relative, or box-root absolute) must point to an existing file or directory inside the box (Broken link: /_content/gone.png)

1 broken internal link(s) in 1 file (warning — not blocking the commit; fix with \`bbx mv\` or by correcting the link)`);
});

void test("line 105", async (t) => {
  // doctest:L106
  const box4 = await makeTmpBox();
  await mkdir(join(box4.root, "_content/img"), { recursive: true });
  await writeFile(join(box4.root, "_content/img/a.png"), "x");
  await writeFile(join(box4.root, "_content/ok.md"), "![a](/_content/img/a.png)\n");
  const clean = await boxWideLinkWarnings(box4.root);
  await box4.cleanup();
  t.check(clean, null);
});

// Generated docs (`docs/generated/`, regenerated and full of placeholder example
// links) are skipped, so they never flood the warning. The shape that actually
// appeared on prod is nested per area (`_content/<area>/docs/generated/`); the old
// root-anchored ignore missed it, so placeholder links leaked into the scan:
void test("Generated docs (docs/generated/, regenerated and full of placeholder example...", async (t) => {
  // doctest:L122
  const box6 = await makeTmpBox();
  await mkdir(join(box6.root, "_content/roadtrip/docs/generated"), { recursive: true });
  await writeFile(join(box6.root, "_content/roadtrip/docs/generated/card-doc.md"), "![caffeine](/_content/figures/Molecule.figure.card)\n[Recipe](/_content/archive/Pasta.recipe.card)\n");
  const nestedWarn = await boxWideLinkWarnings(box6.root);
  await box6.cleanup();
  t.check(nestedWarn, null);
});

// The box-specific `_config/bbx-validate.ignore` (the boxholder's gitignore-style
// escape hatch) suppresses links under any path it matches. A broken link in a
// vendored tree is silenced once the tree is listed, and restored when it isn't:
void test("The box-specific config/bbx-validate.ignore (the boxholder's gitignore-style...", async (t) => {
  // doctest:L136
  const box7 = await makeTmpBox();
  await mkdir(join(box7.root, "vendor/imported"), { recursive: true });
  await writeFile(join(box7.root, "vendor/imported/sample.md"), "![gone](/_content/nope.png)\n");

  // doctest:L140
  const beforeIgnore = await boxWideLinkWarnings(box7.root);
  t.check(beforeIgnore, str`error  ${box7.root}/vendor/imported/sample.md:1  [BBX002] Internal links (relative, or box-root absolute) must point to an existing file or directory inside the box (Broken link: /_content/nope.png)

1 broken internal link(s) in 1 file (warning — not blocking the commit; fix with \`bbx mv\` or by correcting the link)`);

  // doctest:L146
  await mkdir(join(box7.root, "_config"), { recursive: true });
  await writeFile(join(box7.root, "_config/bbx-validate.ignore"), "vendor/**\n");
  const afterIgnore = await boxWideLinkWarnings(box7.root);
  await box7.cleanup();
  t.check(afterIgnore, null);
});
