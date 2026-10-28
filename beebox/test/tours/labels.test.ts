// Label audit: controls that share a role, name and container are one control
// to the box agent.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ambiguousControls, describeAmbiguous } from "./tour-lib/labels.js";
import type { ControlEntry } from "../../src/frontend/src/lib/ui-scan/types.js";

function entry(over: Partial<ControlEntry>): ControlEntry {
  return { kind: "control", id: null, role: "button", name: "Run", container: "Schedules", does: null, actions: [], disabled: false, offscreen: false, ...over };
}

void test("repeated role + name + container is ambiguous; a different container or role is not", async (t) => {
  const groups = ambiguousControls([
    entry({}),
    entry({}),
    entry({}),
    entry({ container: "Recent activity" }),
    entry({ role: "link" }),
    entry({ name: "Later", container: null }),
    entry({ name: "Later", container: null }),
    // A landmark is a container, never a control to tell apart.
    entry({ kind: "landmark", name: "Later", container: null }),
  ]);
  await t.check(groups.map((g) => describeAmbiguous(g)), [
    "3 buttons named \"Run\" in \"Schedules\"",
    "2 buttons named \"Later\" with no named container",
  ]);
});

void test("distinct names are not ambiguous", async (t) => {
  await t.check(ambiguousControls([entry({ name: "Run nightly" }), entry({ name: "Run digest" })]), []);
});
