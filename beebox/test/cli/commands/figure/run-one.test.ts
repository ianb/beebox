// # bbx figure run-one: the error line for a run that threw
//
// No GPU adapter is the host's problem, not the sketch's: the box-figures plan
// (C2) has the text say so, so the agent asks the boxholder instead of
// rewriting a sketch that is fine. Every other error keeps its own message.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { NoGpuAdapterError } from "@ianbicking/canvas-loop/headless";
import { runErrorText } from "../../../../src/cli/commands/figure/run-one.js";

void test("No GPU adapter names possible causes and says to ask the boxholder; other errors keep their message", (t) => {
  t.check(
    runErrorText(new NoGpuAdapterError({ transcriptPath: "/box/_tmp/figure-run/Dot/out/transcript.md" })),
    "no GPU adapter: Dawn found no GPU it can use here. Possible causes: no Vulkan driver is installed (on Linux, Mesa's mesa-vulkan-drivers), the driver does not load inside the box's sandbox, or the driver rejects this machine. Ask the boxholder; rewriting the sketch will not help.",
  );
  t.check(runErrorText(new Error("initial param \"sped\": the sketch declares no such param")), "initial param \"sped\": the sketch declares no such param");
  t.end();
});
