// # Box-growth partial results at the scan deadline
//
// This integration check deliberately waits for the native scan deadline. It is
// excluded from the default suite because its fixed wall-clock delay is too
// expensive for every run. The weekly manual-test job runs it instead.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import { scanBoxGrowth } from "../../src/core/box-growth/scan.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// A native traversal that times out retains every complete type/path pair it
// already streamed.
void test("A native traversal that times out retains every complete type/path pair it al...", async (t) => {
  t.teardown(async () => {
    try {
      await partialBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L17
  const partialBox = await makeTmpBox();
  const fakeFind = partialBox.path("fake-find.sh");
  await fs.writeFile(fakeFind, [
    "#!/bin/sh",
    "printf 'd\\000%s\\000' \"$1/box\"",
    "printf 'd\\000%s\\000' \"$1/box/inbox/email\"",
    "printf 'f\\000%s\\000' \"$1/box/inbox/email/message.txt\"",
    "exec sleep 5",
  ].join("\n"));
  await fs.chmod(fakeFind, 0o700);
  const partialMeasurement = await scanBoxGrowth(partialBox.root, {
    now: new Date("2026-08-05T13:00:00Z"),
    maxDurationMs: 500,
    findCommand: fakeFind,
  });
  t.check(
    {
      complete: partialMeasurement.complete,
      directories: partialMeasurement.counts.directories,
      files: partialMeasurement.counts.files,
      largest: partialMeasurement.largestSubtrees[0]?.path,
      filesystemError: partialMeasurement.filesystemError,
    },
    {
      complete: false,
      directories: 2,
      files: 1,
      largest: "box/inbox/email",
      filesystemError: "Box growth scan exceeded its time budget",
    },
  );
});
