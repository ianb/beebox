// # Telling "no answer" from other upstream failures
//
// A capture that gets no answer prints the display-asleep hint. Upstream 0.41.0
// reports a timed-out read itself, before this wrapper's ceiling fires, so its
// "os error 35" text counts as no answer too. Any other failure, such as a bad
// selector, is upstream's own message and passes through unchanged.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { AgentBrowserError } from "agent-browser-typed";
import { noAnswer } from "../src/stuck.js";

const failure = (stderr: string, timedOut: boolean) => new AgentBrowserError({ code: 1, stderr, stdout: "", args: ["screenshot"], timedOut });

void test("Upstream's read timeout and the wrapper's own ceiling count as no answer; other failures do not", async (t) => {
  t.check([
    noAnswer(failure("✗ Failed to read: Resource temporarily unavailable (os error 35) (the command reached the daemon but no response came back; it may or may not have run, so it was not retried)", false)),
    noAnswer(failure("killed after 45000ms", true)),
    noAnswer(failure("✗ Element not found: #nope", false)),
    noAnswer(new Error("os error 35")),
  ], [true, true, false, false]);
});
