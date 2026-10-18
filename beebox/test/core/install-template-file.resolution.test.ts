// # Parked template resolution
//
// The installer keeps both local and upstream edits when a recorded stock version provides a clean three-way merge. A conflicting edit stays parked for an agent to inspect.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { installTemplateFile, listParkedTemplateUpdates } from "../../src/core/install-template-file.js";
import { readTemplateUpdate, resolveTemplateUpdate, recordAutomatedTemplateRewrite } from "../../src/core/template-update.js";
import { templateCommand } from "../../src/cli/commands/template.js";

const boxes: string[] = [];
async function box() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-template-resolution-"));
  boxes.push(root);
  return root;
}
const rel = "_config/example.guide.card";
const v1 = "heading\nlocal line\nseparator\nupstream line\nfooter\n";
async function seed(root: string) { await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: v1 }); }
async function write(root: string, content: string) { await fs.writeFile(path.join(root, rel), content); }

// A clean merge records the new stock hash and does not re-park on the next install:
void test("A clean merge records the new stock hash and does not re-park on the next ins...", async (t) => {
  // doctest:L28
  const root = await box();
  await seed(root);
  await write(root, v1.replace("local line", "box edit"));
  const v2 = v1.replace("upstream line", "upstream edit");
  const first = await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: v2 });
  t.check(first.outcome, "overwritten");

  // doctest:L36
  await t.checkText((await fs.readFile(path.join(root, rel), "utf-8")).includes("box edit\nseparator\nupstream edit"), "true");

  // doctest:L39
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: v2 })).outcome, "skipped");

  // doctest:L42
  t.check(await listParkedTemplateUpdates(root), []);
});

// A schedule's box-owned `enabled` value survives acceptance and its canonical pending hash is recorded:
void test("A schedule's box-owned enabled value survives acceptance and its canonical pe...", async (t) => {
  // doctest:L49
  const root = await box();
  const schedule = "_config/schedules/example.scheduled-script.card";
  const old = "---\nruns: bbx sync\ndescription: old\n---\n";
  await installTemplateFile({ boxRoot: root, relPath: schedule, templateContent: old, boxOwnedFields: ["enabled"] });
  await fs.writeFile(path.join(root, schedule), "---\nruns: bbx sync --local\ndescription: old\nenabled: false\n---\n");
  const next = "---\nruns: bbx sync\ndescription: new\n---\n";
  t.check((await installTemplateFile({ boxRoot: root, relPath: schedule, templateContent: next, boxOwnedFields: ["enabled"] })).outcome, "parked");

  // doctest:L58
  await resolveTemplateUpdate({ boxRoot: root, relPath: schedule, accept: true });
  await t.checkText((await fs.readFile(path.join(root, schedule), "utf-8")).includes("enabled: false"), "true");

  // doctest:L62
  t.check((await installTemplateFile({ boxRoot: root, relPath: schedule, templateContent: next, boxOwnedFields: ["enabled"] })).outcome, "unchanged");
});

// Two separate conflicts stay parked instead of aborting the install:
void test("Two separate conflicts stay parked instead of aborting the install:", async (t) => {
  // doctest:L69
  const root = await box();
  const stock = "head\nA\na1\na2\na3\na4\na5\nB\ntail\n";
  await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: stock });
  await write(root, stock.replace("\nA\n", "\nbox A\n").replace("\nB\n", "\nbox B\n"));
  const upstream = stock.replace("\nA\n", "\nup A\n").replace("\nB\n", "\nup B\n");
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: upstream })).outcome, "parked");
});

// A migration that rewrites unmodified stock records its new bytes, so a later upstream revision can update it:
void test("A migration that rewrites unmodified stock records its new bytes, so a later...", async (t) => {
  // doctest:L81
  const root = await box();
  await seed(root);
  const migrated = v1.replace("local line", "renamed field");
  await write(root, migrated);
  await recordAutomatedTemplateRewrite({ boxRoot: root, relPath: rel, before: v1, after: migrated });
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: v1.replace("upstream line", "new upstream") })).outcome, "overwritten");
});

// An automated rewrite of a box-customized copy does not claim that content as stock:
void test("An automated rewrite of a box-customized copy does not claim that content as...", async (t) => {
  // doctest:L93
  const root = await box();
  await seed(root);
  await write(root, "box customized\n");
  await recordAutomatedTemplateRewrite({ boxRoot: root, relPath: rel, before: "box customized\n", after: "box migrated\n" });
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: "new upstream\n" })).outcome, "parked");
});

// A text merge that creates invalid YAML frontmatter also stays parked:
void test("A text merge that creates invalid YAML frontmatter also stays parked:", async (t) => {
  // doctest:L104
  const root = await box();
  const stock = "---\na: one\nb: two\nc: three\nd: four\ne: five\nf: six\n---\nbody\n";
  await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: stock });
  await write(root, stock.replace("a: one\n", "a: one\nshared: local\n"));
  const upstream = stock.replace("f: six\n", "f: six\nshared: upstream\n");
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: upstream })).outcome, "parked");
});

// When both sides edit the same line, the park and its three views remain available:
void test("When both sides edit the same line, the park and its three views remain avail...", async (t) => {
  // doctest:L116
  const root = await box();
  await seed(root);
  await write(root, v1.replace("local line", "box edit"));
  const v2 = v1.replace("local line", "upstream edit");
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: v2 })).outcome, "parked");

  // doctest:L123
  const views = await readTemplateUpdate(root, rel);
  t.check([views.stock === v1, views.local.includes("box edit"), views.parked.includes("upstream edit")], [
    true,
    true,
    true,
  ]);

  // doctest:L127
  let aliasError = "";
  try {
    await resolveTemplateUpdate({ boxRoot: root, relPath: `./${rel}`, accept: false });
  } catch (error) {
    aliasError = error instanceof Error ? error.name : String(error);
  }
  t.check(aliasError, "InvalidTemplatePathError");

  // An agent can accept wholesale, or write its own merged local file and resolve the parked version. Both choices record the upstream version so it does not re-park:

  // doctest:L140
  await resolveTemplateUpdate({ boxRoot: root, relPath: rel, accept: true });
  await t.checkText((await fs.readFile(path.join(root, rel), "utf-8")) === v2, "true");

  // doctest:L144
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: v2 })).outcome, "unchanged");

  // doctest:L147
  await write(root, v2.replace("upstream edit", "box judgment"));
  const v3 = v2.replace("upstream edit", "later upstream");
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: v3 })).outcome, "parked");

  // doctest:L152
  await write(root, v3.replace("later upstream", "agent merged both"));
  await resolveTemplateUpdate({ boxRoot: root, relPath: rel, accept: false });
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: v3 })).outcome, "skipped");

  // doctest:L157
  t.check(await listParkedTemplateUpdates(root), []);
});

// Older tracker entries have a hash but no stock bytes; their diff says so, and accept still works:
void test("Older tracker entries have a hash but no stock bytes; their diff says so, and...", async (t) => {
  // doctest:L164
  const root = await box();
  await seed(root);
  const versionsPath = path.join(root, "_config/template-versions.json");
  const versions = JSON.parse(await fs.readFile(versionsPath, "utf-8"));
  delete versions[rel].stock;
  await fs.writeFile(versionsPath, JSON.stringify(versions));
  await write(root, "box edit\n");
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: "upstream\n" })).outcome, "parked");

  // doctest:L174
  t.check((await readTemplateUpdate(root, rel)).stock, null);

  // doctest:L177
  await resolveTemplateUpdate({ boxRoot: root, relPath: rel, accept: true });
  t.check((await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: "upstream\n" })).outcome, "unchanged");
});

// The box-agent command displays the comparison and accepts the parked copy in a temporary box:
void test("The box-agent command displays the comparison and accepts the parked copy in...", async (t) => {
  t.teardown(async () => {
    try {
      for (const root of boxes) await fs.rm(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L185
  const root = await box();
  await fs.mkdir(path.join(root, ".beebox"));
  await fs.writeFile(path.join(root, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
  await seed(root);
  await write(root, v1.replace("local line", "box edit"));
  await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: v1.replace("local line", "upstream edit") });
  const cwd = process.cwd();
  const originalLog = console.log;
  const lines: string[] = [];
  try {
    process.chdir(root);
    console.log = (line: string) => lines.push(line);
    await templateCommand.parseAsync(["diff", rel], { from: "user" });
    await templateCommand.parseAsync(["accept", rel], { from: "user" });
  } finally {
    console.log = originalLog;
    process.chdir(cwd);
  }
  t.check([lines.some((line) => line.includes("Last stock vs local:")), lines.some((line) => line.includes("+box edit")), lines.some((line) => line.includes("Accepted"))], [
    true,
    true,
    true,
  ]);

  // doctest:L206
  t.check(await listParkedTemplateUpdates(root), []);
});
