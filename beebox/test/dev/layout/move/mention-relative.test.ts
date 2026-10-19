// # Form 4: a mention relative to the mentioning file's own directory

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { relativeCandidates, isRelativeMentionCandidateFile } from "../../../../src/dev/layout/move/mention-relative.js";

const move = { from: "pkg/src/a.ts", to: "pkg/src/sub/a.ts" };
const moveMap = new Map([[move.from, move.to]]);

// ## A `.ts` module gets three candidate styles (raw, `.js`, extensionless), relative to the mentioning file's directory
void test("A `.ts` module gets three candidate styles (raw, `.js`, extensionless), relative to the mentioning file's directory", async (t) => {
  const candidates = relativeCandidates({ move, mentioningPath: "pkg/docs/readme.md", moveMap });
  t.check(candidates, [
    {
      old: "../src/a.ts",
      new: "../src/sub/a.ts",
    },
    {
      old: "../src/a.js",
      new: "../src/sub/a.js",
    },
    {
      old: "../src/a",
      new: "../src/sub/a",
    },
  ]);
});

// ## When the mentioning file itself also moves, the "new" side is relative to ITS new directory
void test("When the mentioning file itself also moves, the \"new\" side is relative to ITS new directory", async (t) => {
  const movedMentioner = new Map([[move.from, move.to], ["pkg/docs/readme.md", "pkg/deep/guides/readme.md"]]);
  const candidates2 = relativeCandidates({ move, mentioningPath: "pkg/docs/readme.md", moveMap: movedMentioner });
  t.check(candidates2[0], {
    old: "../src/a.ts",
    new: "../../src/sub/a.ts",
  });
});

// ## A non-module (no real extension swap) move gets only its raw extension's candidate
void test("A non-module (no real extension swap) move gets only its raw extension's candidate", async (t) => {
  const jsonMove = { from: "pkg/data/x.json", to: "pkg/data/y/x.json" };
  t.check(relativeCandidates({ move: jsonMove, mentioningPath: "pkg/scripts/run.sh", moveMap: new Map([[jsonMove.from, jsonMove.to]]) }), [
    {
      old: "../data/x.json",
      new: "../data/y/x.json",
    },
  ]);
});

// ## Only JSON/shell/YAML/Markdown files are relative-mention candidates — a `.ts` file's specifiers are the AST importer's job instead
void test("Only JSON/shell/YAML/Markdown files are relative-mention candidates — a `.ts` file's specifiers are the AST importer's job instead", async (t) => {
  t.check(isRelativeMentionCandidateFile("docs/note.md"), true);

  t.check(isRelativeMentionCandidateFile("scripts/run.sh"), true);

  t.check(isRelativeMentionCandidateFile("src/a.ts"), false);
});
