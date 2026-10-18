// # Mention-rewrite text mechanics: the path-token boundary rule and `knip.ts` block scoping

import { test } from "tap";
import "agent-doctest/tap";
import {
  containsToken,
  replaceToken,
  replaceDirectoryToken,
  knipWorkspaceBlockRange,
  replaceTokenInRange,
} from "../../../../src/dev/layout/move/mention-apply.js";

// ## A file token match requires non-path-character boundaries: `src/core/foo.ts` inside `src/core/foo.tsx` or `xsrc/core/foo.ts` doesn't count
void test("A file token match requires non-path-character boundaries: `src/core/foo.ts` inside `src/core/foo.tsx` or `xsrc/core/foo.ts` doesn't count", async (t) => {
  // doctest:L16
  t.check(containsToken({ text: "import from src/core/foo.tsx", literal: "src/core/foo.ts" }), false);

  // doctest:L19
  t.check(containsToken({ text: "see xsrc/core/foo.ts here", literal: "src/core/foo.ts" }), false);

  // doctest:L22
  t.check(containsToken({ text: '"src/core/foo.ts"', literal: "src/core/foo.ts" }), true);
});

// ## `replaceToken` rewrites every token match and reports the count; a non-matching text is untouched
void test("`replaceToken` rewrites every token match and reports the count; a non-matching text is untouched", async (t) => {
  // doctest:L29
  t.check(replaceToken({ text: "See `src/core/foo.ts` and src/core/foo.ts again.", oldToken: "src/core/foo.ts", newToken: "src/core/bar.ts" }), {
    text: "See `src/core/bar.ts` and src/core/bar.ts again.",
    count: 2,
  });

  // doctest:L32
  t.check(replaceToken({ text: "unrelated text", oldToken: "src/core/foo.ts", newToken: "src/core/bar.ts" }), {
    text: "unrelated text",
    count: 0,
  });
});

// ## A directory token matches a bare mention (with or without a trailing slash) and a glob continuation, but not a deeper specific file — that's a file mention, already `fileForms`'s job
void test("A directory token matches a bare mention (with or without a trailing slash) and a glob continuation, but not a deeper specific file — that's a file mention, already `fileForms`'s job", async (t) => {
  // doctest:L39
  t.check(containsToken({ text: "scripts/migrated/foo.ts", literal: "scripts/migrate", kind: "directory" }), false);

  // doctest:L42
  t.check(containsToken({ text: "see scripts/migrate/foo.ts here", literal: "scripts/migrate", kind: "directory" }), false);

  // doctest:L45
  t.check(containsToken({ text: '"scripts/migrate/"', literal: "scripts/migrate", kind: "directory" }), true);

  // doctest:L48
  t.check(containsToken({ text: '"scripts/migrate/**/*.ts"', literal: "scripts/migrate", kind: "directory" }), true);
});

// ## `replaceDirectoryToken` rewrites a plain directory mention but skips a line with a glob metacharacter, leaving it for review
void test("`replaceDirectoryToken` rewrites a plain directory mention but skips a line with a glob metacharacter, leaving it for review", async (t) => {
  // doctest:L55
  const globText = 'moved: "src/schemas/"\nproject: "src/schemas/**/*.list-entry.tsx"\n';
  t.check(replaceDirectoryToken({ text: globText, oldToken: "src/schemas", newToken: "src/cards" }), {
    text: `moved: "src/cards/"
project: "src/schemas/**/*.list-entry.tsx"
`,
    count: 1,
  });
});

// ## `knipWorkspaceBlockRange` finds the balanced-brace range of one package's block, and `replaceTokenInRange` confines a rewrite to it
void test("`knipWorkspaceBlockRange` finds the balanced-brace range of one package's block, and `replaceTokenInRange` confines a rewrite to it", async (t) => {
  // doctest:L63
  const knipText = `export default {
  workspaces: {
    "beebox": {
      entry: ["src/cli/entry/run.ts"],
    },
    "canvas-loop": {
      entry: ["src/cli/entry/run.ts"],
    },
  },
};
`;
  const range = knipWorkspaceBlockRange(knipText, "beebox")!;
  await t.checkText(knipText.slice(range.start, range.end).includes("canvas-loop"), "false");

  // doctest:L78
  const rewritten = replaceTokenInRange({ text: knipText, oldToken: "src/cli/entry/run.ts", newToken: "src/cli/entry/run.ts", range });
  t.check(rewritten.count, 1);

  // doctest:L82
  await t.checkText(rewritten.text.includes('"beebox": {\n      entry: ["src/cli/entry/run.ts"],'), "true");

  // doctest:L85
  await t.checkText(rewritten.text.includes('"canvas-loop": {\n      entry: ["src/cli/entry/run.ts"],'), "true");

  // doctest:L88
  t.check(knipWorkspaceBlockRange(knipText, "no-such-package"), null);
});
