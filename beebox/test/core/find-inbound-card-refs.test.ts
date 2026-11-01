// # Inbound card references report incomplete scans
//
// The inbound-reference reader returns partial results together with read errors.
// That distinction keeps an unreadable referrer from looking like proof that a
// card has no mentions.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import { findInboundCardRefs } from "../../src/core/find-inbound-card-refs.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// ## Read failures accompany the references that could be scanned
void test("Read failures accompany the references that could be scanned", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/box/notes/Target.doc.card", "---\ntype: doc\ntitle: Target\n---\n");
  await box.write("_content/box/notes/Readable.md", "[target](Target.doc.card)\n");
  await box.write("_content/box/notes/Unreadable.md", "[target](Target.doc.card)\n");

  const unreadable = box.path("_content/box/notes/Unreadable.md");
  const result = await findInboundCardRefs({
    boxRoot: box.root,
    cardPath: "_content/box/notes/Target.doc.card",
    readText: async (filePath) => {
      if (filePath === unreadable) throw new Error("fixture read failure");
      return fs.readFile(filePath, "utf-8");
    },
  });
  t.check(result, {
    referrers: [{ path: "_content/box/notes/Readable.md", refs: 1, fragments: [] }],
    errors: ["_content/box/notes/Unreadable.md: Error: fixture read failure"],
  });
});

// ## Each ref's #fragment is reported with the referrer
//
// `bbx refs` (docs/plans/knowledge-base-tools.md, Track D). Relative and
// box-absolute refs both resolve to the target; the count is unchanged by the
// observation, and a ref with no fragment counts without listing one.
void test("Each ref's #fragment is reported with the referrer", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/box/notes/Target.doc.card", "---\ntype: doc\ntitle: Target\n---\n## Risks\n");
  await box.write(
    "_content/box/notes/Citer.md",
    "[a](Target.doc.card#risks) and [b](/_content/box/notes/Target.doc.card#c1), [c](Target.doc.card), [d](Other.doc.card#x)\n",
  );
  const result = await findInboundCardRefs({ boxRoot: box.root, cardPath: "_content/box/notes/Target.doc.card" });
  t.check(result, {
    referrers: [{ path: "_content/box/notes/Citer.md", refs: 3, fragments: ["risks", "c1"] }],
    errors: [],
  });
});
