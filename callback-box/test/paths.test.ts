/**
 * Tests for path utilities.
 */

import { test } from "tap";
import {
  parseCardName,
  buildCardName,
  isCardFile,
  BOX_DIRS,
} from "../src/cli/lib/paths.js";

test("parseCardName", async (t) => {
  t.same(parseCardName("Test.memo.card"), { name: "Test", type: "memo" });
  t.same(parseCardName("Meeting_Tomorrow.email-thread.card"), {
    name: "Meeting_Tomorrow",
    type: "email-thread",
  });
  t.same(parseCardName("Q1.question.card"), { name: "Q1", type: "question" });
  t.equal(parseCardName("invalid.card"), null);
  t.equal(parseCardName("no-extension"), null);
  t.equal(parseCardName("only.card"), null);
});

test("buildCardName", async (t) => {
  t.equal(buildCardName("Test", "memo"), "Test.memo.card");
  t.equal(
    buildCardName("Meeting_Tomorrow", "email-thread"),
    "Meeting_Tomorrow.email-thread.card"
  );
});

test("isCardFile", async (t) => {
  t.equal(isCardFile("Test.memo.card"), true);
  t.equal(isCardFile("/path/to/Test.memo.card"), true);
  t.equal(isCardFile("Test.memo"), false);
  t.equal(isCardFile("Test.card.bak"), false);
});

test("BOX_DIRS constants", async (t) => {
  t.equal(BOX_DIRS.inbox, "box/inbox");
  t.equal(BOX_DIRS.questions, "box/questions");
  t.equal(BOX_DIRS.archiveDone, "store/archive/done");
});
