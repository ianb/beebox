// # Move list: `parseMoveList`

import { test } from "tap";
import "agent-doctest/tap";
import { parseMoveList } from "../../../../src/dev/layout/move/list.js";

// ## A well-formed list parses; other top-level keys are ignored
void test("A well-formed list parses; other top-level keys are ignored", async (t) => {
  // doctest:L10
  await t.checkText(
    JSON.stringify(
      parseMoveList(JSON.stringify({ moves: [{ from: "a.ts", to: "b.ts" }], notes: "ignored" })),
    ),
    "[{\"from\":\"a.ts\",\"to\":\"b.ts\"}]",
  );
});

// ## Invalid JSON, a missing `moves` array, and a malformed entry each throw
void test("Invalid JSON, a missing `moves` array, and a malformed entry each throw", async (t) => {
  // doctest:L19
  await t.checkThrows(async () => (parseMoveList("not json")), "MoveListNotJsonError");

  // doctest:L22
  await t.checkThrows(async () => (parseMoveList(JSON.stringify({}))), "MoveListShapeError");

  // doctest:L25
  await t.checkThrows(async () => (parseMoveList(JSON.stringify({ moves: ["x"] }))), "MoveEntryNotObjectError");

  // doctest:L28
  await t.checkThrows(async () => (parseMoveList(JSON.stringify({ moves: [{ to: "b.ts" }] }))), "MoveEntryMissingFromError");

  // doctest:L31
  await t.checkThrows(async () => (parseMoveList(JSON.stringify({ moves: [{ from: "a.ts", to: "" }] }))), "MoveEntryMissingToError");
});
