// # `generateDocs`'s template-sync commit
//
// `commitTemplateSyncChanges` (in `src/core/docs-gen/generate/core.ts`) runs at the box
// root and filters `git status` output through `isTemplateManagedPath`
// (`src/core/install-template-file.ts`) before committing — so only files the
// `install*`/`generateRules` helpers actually manage get swept up, leaving any
// other in-progress user work untouched.
//
// shapeVersion 3 has one root, so every git-status path `getStatus` reports is
// already box-root-relative — no prefix normalization needed. This doctest
// exercises the sync commit directly against a minimal fixture, without also
// going through the full `generateDocs` pipeline (which would also install a
// real, executable `.git/hooks/pre-commit` that shells out to a `bbx` binary —
// an unrelated hazard in a repo-in-a-repo dev/test environment).

import { test } from "tap";
import "agent-doctest/tap";
import { rm } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { commitTemplateSyncChanges, generateDocs } from "../../../src/core/docs-gen/generate/core.js";
import { isTemplateManagedPath } from "../../../src/core/install-template-file.js";
import { getStatus, getLog } from "../../../src/lib/git/core/operations.js";

// ## Template-managed files get committed; an unrelated dirty file doesn't
//
// Simulate what the `install*` helpers would have dirtied: a box-root template
// (`_config/template-versions.json`, already tracked by the scaffold's init
// commit) — plus one unrelated new file a boxholder is mid-edit on.
void test("Simulate what the install helpers would have dirtied:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L31
  const box = await makeTmpBox({ git: true });
  await box.write("_config/template-versions.json", '{"changed":true}\n');
  await box.write("notes.md", "unrelated dirty file\n");

  // doctest:L35
  const before = await getStatus(box.root);
  t.check(before.modified, [
    "_config/template-versions.json",
  ]);

  // doctest:L39
  t.check(before.untracked, [
    "notes.md",
  ]);

  // `commitTemplateSyncChanges` commits the modified template file and leaves the
  // unrelated one untouched — untracked, uncommitted:

  // doctest:L47
  await commitTemplateSyncChanges(box.root);

  // doctest:L49
  const status = await getStatus(box.root);
  t.check(status.modified, []);

  // doctest:L53
  t.check(status.untracked, [
    "notes.md",
  ]);

  // The commit lands with the expected subject and trailer:

  // doctest:L60
  const log = await getLog(box.root, 1);
  t.check(log[0]?.subject, "Sync templates from upstream");

  // doctest:L64
  t.check(log[0]?.trailers, {
    "Triggered-By": "generateDocs",
  });
});

// ## One generation commits all of its tracked output
//
// `generateDocs` writes tracked output after the template sync: the guide
// rules, `_content/briefing.md`, `AGENTS.md`, the
// `.agents/skills/` mirrors, and `.codex/hooks.json`. The commit runs once, after
// the last of these, so none is left dirty or untracked
// (`issues/closed/bugs/2026-10-08-template-sync-commit-precedes-agent-skill-mirrors.md`).
// A briefing card edit is the case journey walks hit: the compiled
// `_content/briefing.md` changed and stayed uncommitted.
void test("generateDocs writes tracked output after the template sync:", async (t) => {
  t.teardown(async () => {
    try {
      await genBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L83
  const genBox = await makeTmpBox({ git: true });
  await generateDocs(genBox.root, { force: true });
  const card = await genBox.read("_content/briefing.briefing.card");
  await genBox.write("_content/briefing.briefing.card", `${card}\n- Lending reminders go out on Fridays.\n`);
  genBox.commitAll("edit briefing");
  await generateDocs(genBox.root, { force: true });

  // doctest:L90
  const after = await getStatus(genBox.root);
  t.check([...after.staged, ...after.modified, ...after.untracked].filter((p) => isTemplateManagedPath(p)), []);

  // doctest:L94
  t.check((await getLog(genBox.root, 1))[0]?.subject, "Sync templates from upstream");
});

// ## A boxholder's unfinished edit stays out of the generation commit
//
// `isTemplateManagedPath` also matches hand-authored files, such as a rule under
// `.claude/rules/`. A boxholder's uncommitted edit to one, made before
// generation starts, is not this run's output: `generateDocs` reads the dirty
// paths before its first write and leaves them out of its commit. The generated
// outputs from the same run are still committed.
void test("isTemplateManagedPath also matches hand-authored files, such as a rule under...", async (t) => {
  t.teardown(async () => {
    try {
      await userBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L111
  const userBox = await makeTmpBox({ git: true });
  await generateDocs(userBox.root, { force: true });
  await userBox.write(".claude/rules/lending.md", "Lend books for two weeks.\n");
  const briefing = await userBox.read("_content/briefing.briefing.card");
  await userBox.write("_content/briefing.briefing.card", `${briefing}\n- Lending reminders go out on Fridays.\n`);
  userBox.commitAll("add a lending rule and edit the briefing");
  await userBox.write(".claude/rules/lending.md", "Lend books for three weeks.\n");
  await generateDocs(userBox.root, { force: true });

  // doctest:L120
  const afterUserEdit = await getStatus(userBox.root);
  t.check([...afterUserEdit.staged, ...afterUserEdit.modified, ...afterUserEdit.untracked].filter((p) => isTemplateManagedPath(p)), [
    ".claude/rules/lending.md",
  ]);

  // doctest:L124
  t.check((await getLog(userBox.root, 1))[0]?.subject, "Sync templates from upstream");
});

// ## An authored AGENTS.md stays out of the generation commit
//
// In a converted box `AGENTS.md` is the box's own instruction file. The legacy
// `**/AGENTS.md` mirror row still matches its path, so the commit filter skips a
// regular-file `AGENTS.md`: when generation adds the agent-guide include to the
// root file, that edit is left for the boxholder, as edits to the root
// `CLAUDE.md` always were.
void test("In a converted box AGENTS.md is the box's own instruction file.", async (t) => {
  t.teardown(async () => {
    try {
      await authoredBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L141
  const authoredBox = await makeTmpBox({ git: true });
  await generateDocs(authoredBox.root, { force: true });
  await authoredBox.write("AGENTS.md", "House rules.\n");
  authoredBox.commitAll("trim the root instructions");
  await generateDocs(authoredBox.root, { force: true });

  // doctest:L147
  await t.checkText((await authoredBox.read("AGENTS.md")).includes("@.beebox/agent-guide.md"), "true");

  // doctest:L150
  await t.checkText((await getStatus(authoredBox.root)).modified.includes("AGENTS.md"), "true");

  // A tracked guide is engine output, not the box's own file: when generation
  // reinstalls `src/schemas/AGENTS.md`, the same commit takes it.

  // doctest:L158
  await rm(authoredBox.path("src/schemas/AGENTS.md"));
  authoredBox.commitAll("drop the schemas guide");
  await generateDocs(authoredBox.root, { force: true });

  // doctest:L162
  await t.checkText((await authoredBox.read("src/schemas/AGENTS.md")).startsWith("# Writing Box-Local Schemas"), "true");

  // doctest:L165
  const afterGuide = await getStatus(authoredBox.root);
  await t.checkText([...afterGuide.staged, ...afterGuide.modified, ...afterGuide.untracked].includes("src/schemas/AGENTS.md"), "false");
});
