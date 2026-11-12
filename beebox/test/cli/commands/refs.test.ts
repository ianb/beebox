// # bbx refs
//
// docs/plans/knowledge-base-tools.md, Track D. One line per referrer with the
// anchors it names; `card#anchor` keeps only referrers naming that anchor.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatReferrer, referrersNaming, refsCommand } from "../../../src/cli/commands/refs.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const referrers = [
  { path: "a.md", refs: 3, fragments: ["x", "y"] },
  { path: "b.md", refs: 1, fragments: [] },
  { path: "c.md", refs: 2, fragments: ["x", "x"] },
];

void test("A referrer line lists its anchors", (t) => {
  t.check(referrers.map(formatReferrer), ["a.md  (3 refs: #x, #y)", "b.md  (1 ref)", "c.md  (2 refs: #x, #x)"]);
  t.end();
});

void test("An anchor keeps only the referrers that name it, with those refs", (t) => {
  t.check(referrersNaming(referrers, "x"), [
    { path: "a.md", refs: 1, fragments: ["x"] },
    { path: "c.md", refs: 2, fragments: ["x", "x"] },
  ]);
  t.check(referrersNaming(referrers, "zzz"), []);
  t.end();
});

void test("The command prints one line per referrer, filtered by #anchor", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_content/box/Target.doc.card", "---\ntype: doc\ntitle: T\n---\n## Risks\n");
  await box.write("_content/box/A.md", "[r](Target.doc.card#risks) [r2](Target.doc.card#risks) [n](Target.doc.card)\n");
  await box.write("_content/box/B.md", "[o](Target.doc.card#other)\n");
  const cwd = process.cwd();
  process.chdir(box.root);
  t.teardown(() => { process.chdir(cwd); });
  const run = async (args: string[]): Promise<string[]> => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => { lines.push(line); };
    try {
      await refsCommand.parseAsync(args, { from: "user" });
    } finally {
      console.log = log;
    }
    return lines;
  };
  t.check(await run(["_content/box/Target.doc.card"]), ["_content/box/A.md  (3 refs: #risks, #risks)", "_content/box/B.md  (1 ref: #other)"]);
  t.check(await run(["_content/box/Target.doc.card#risks"]), ["_content/box/A.md  (2 refs: #risks, #risks)"]);
});
