// # Reading `agent-browser session list`
//
// The browser page starts the box session only when the list parses and lacks
// it (docs/plans/shared-browser.md, Track C); output in any other shape must
// read as unknown, so a page the person was using is never replaced.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseSessionList } from "../../../src/core/browser/session.js";

void test("Known shapes give the names; anything else is unknown", async (t) => {
  t.check(
    {
      none: parseSessionList("No active sessions\n"),
      // The shape agent-browser 0.39.2 prints.
      some: parseSessionList("Active sessions:\n→ box\n   agent1\n"),
      ascii: parseSessionList("Active sessions:\n-> box\n"),
      error: parseSessionList("Error: daemon not responding\n"),
      oddName: parseSessionList("Active sessions:\n-> box (stale)\n"),
    },
    { none: [], some: ["box", "agent1"], ascii: ["box"], error: null, oddName: null },
  );
});
