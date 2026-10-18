// # Inbound card references report incomplete scans
//
// The inbound-reference reader returns partial results together with read errors.
// That distinction keeps an unreadable referrer from looking like proof that a
// card has no mentions.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import { findInboundCardRefs } from "../../src/core/find-inbound-card-refs.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// ## Read failures accompany the references that could be scanned
void test("Read failures accompany the references that could be scanned", async (t) => {
  // doctest:L16
  const box = await makeTmpBox();
  await box.write("_content/box/notes/Target.doc.card", "---\ntype: doc\ntitle: Target\n---\n");
  await box.write("_content/box/notes/Readable.md", "[target](Target.doc.card)\n");
  await box.write("_content/box/notes/Unreadable.md", "[target](Target.doc.card)\n");

  // doctest:L21
  const unreadable = box.path("_content/box/notes/Unreadable.md");
  const result = await findInboundCardRefs({
    boxRoot: box.root,
    cardPath: "_content/box/notes/Target.doc.card",
    readText: async (filePath) => {
      if (filePath === unreadable) throw new Error("fixture read failure");
      return fs.readFile(filePath, "utf-8");
    },
  });
  t.check(result.referrers, [
    {
      path: "_content/box/notes/Readable.md",
      refs: 1,
    },
  ]);

  // doctest:L33
  await t.checkText(result.errors.length, "1");

  // doctest:L36
  t.check(result.errors[0]?.includes("_content/box/notes/Unreadable.md: Error: fixture read failure"), true);
});
