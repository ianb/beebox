// # The trigger status line's words
//
// "Watching: …" names the armed triggers; a failed one, or one whose fire
// could not be delivered, reads "not working"; done, expired and disarmed
// ones say nothing, so the line disappears when nothing is live.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { triggerStatusLines } from "../../../../../src/components/chat/everywhere/InteractiveChat/trigger-status.js";

void test("The status line names armed triggers and failed ones, nothing else.", (t) => {
  t.check(triggerStatusLines([]), []);
  t.check(triggerStatusLines([{ label: "Water check", state: "armed" }]), ["Watching: Water check"]);
  t.check(triggerStatusLines([
    { label: "Water check", state: "armed" },
    { label: "Stuck check", state: "failed" },
    { label: "Old one", state: "expired" },
    { label: "Ammonia", state: "armed" },
    { label: "Gone", state: "delivery-failed" },
  ]), ["Watching: Water check, Ammonia", "Stuck check: not working", "Gone: not working"]);
  t.check(triggerStatusLines([{ label: "Done", state: "done" }, { label: "Off", state: "disarmed" }]), []);
  t.end();
});
