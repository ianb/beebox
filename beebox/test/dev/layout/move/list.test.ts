// # Move list: `parseMoveList`

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseMoveList } from "../../../../src/dev/layout/move/list.js";

// ## A well-formed list parses; other top-level keys are ignored
void test("A well-formed list parses; other top-level keys are ignored", async (t) => {
  await t.checkText(
    JSON.stringify(
      parseMoveList(JSON.stringify({ moves: [{ from: "a.ts", to: "b.ts" }], notes: "ignored" })),
    ),
    "[{\"from\":\"a.ts\",\"to\":\"b.ts\"}]",
  );
});

// ## Invalid JSON, a missing `moves` array, and a malformed entry each throw
void test("Invalid JSON, a missing `moves` array, and a malformed entry each throw", async (t) => {
  await t.checkThrows(async () => (parseMoveList("not json")), "MoveListNotJsonError");

  await t.checkThrows(async () => (parseMoveList(JSON.stringify({}))), "MoveListShapeError");

  await t.checkThrows(async () => (parseMoveList(JSON.stringify({ moves: ["x"] }))), "MoveEntryNotObjectError");

  await t.checkThrows(async () => (parseMoveList(JSON.stringify({ moves: [{ to: "b.ts" }] }))), "MoveEntryMissingFromError");

  await t.checkThrows(async () => (parseMoveList(JSON.stringify({ moves: [{ from: "a.ts", to: "" }] }))), "MoveEntryMissingToError");
});
