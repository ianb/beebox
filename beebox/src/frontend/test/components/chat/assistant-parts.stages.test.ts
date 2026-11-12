// # Activity stages (`splitStages`, `assistant-parts.ts`)
//
// Each note the agent writes between steps starts a stage: the note and the
// steps after it, up to the next note. Steps before the first note form a
// first stage with no note. Every step lands in exactly one stage.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { splitStages, type Stage } from "../../../src/components/chat/assistant-parts.js";

const step = (id: string): Stage["parts"][number] => ({ type: "tools", tools: [{ type: "tool_use", toolName: "Bash", toolId: id }] });

void test("Notes split an activity group into stages", async (t) => {
  t.check(
    splitStages([step("a"), { type: "note", text: "Checking the views." }, step("b"), { type: "thinking", text: "hm" }, step("c"), { type: "note", text: "Fixing two." }, { type: "note", text: "Now the second." }, step("d")]),
    [
      { note: null, parts: [step("a")] },
      { note: "Checking the views.", parts: [step("b"), { type: "thinking", text: "hm" }, step("c")] },
      // Two notes in a row: the first heads an empty stage.
      { note: "Fixing two.", parts: [] },
      { note: "Now the second.", parts: [step("d")] },
    ],
  );
  // A group with no notes is one unheaded stage, as the row looked before stages.
  t.check(splitStages([step("a"), step("b")]), [{ note: null, parts: [step("a"), step("b")] }]);
  t.check(splitStages([]), []);
});
