// # Intake stage
//
// `runIntake` is the first stage of the triage pipeline. It does three things
// in one pass:
//
// 1. Routes fresh top-level `_content/inbox/*` cards into `_content/inbox/intake/`,
//    leaving reserved subdirectories alone.
// 2. Applies each registered intake step to every file in `intake/` until
//    no step changes anything (quiescent).
// 3. Moves the intake-complete items to `_content/inbox/staged/`.
//
// See `docs/triage.md` and `src/core/commands/intake/run.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { runIntake } from "../../../../src/core/commands/intake/run.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

// ## Routing fresh arrivals
//
// A top-level card in `_content/inbox/` gets pulled into `_content/inbox/intake/`,
// then (since its filename is already safe) advanced through to
// `_content/inbox/staged/`.
void test("A top-level card in content/inbox/ gets pulled into content/inbox/intake/, th...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/Note.doc.card", "<doc/>");

  const result = await runIntake({ boxRoot: box.root });

  t.check(result, { routed: ["Note.doc.card"], applied: [], staged: ["Note.doc.card"] });

  await t.checkText(await box.list("_content/inbox"), `_content/inbox/.gitkeep
_content/inbox/intake
_content/inbox/intake/.gitkeep
_content/inbox/staged
_content/inbox/staged/.gitkeep
_content/inbox/staged/Note.doc.card
_content/inbox/triaged
_content/inbox/triaged/.gitkeep
_content/inbox/triaged/_unsure
_content/inbox/triaged/_unsure/.gitkeep
_content/inbox/unhandled
_content/inbox/unhandled/.gitkeep`);

  await t.checkText(await box.list("_content/inbox/staged"), `_content/inbox/staged/.gitkeep
_content/inbox/staged/Note.doc.card`);
});

// ## Filename normalization
//
// A card with whitespace or shell-unsafe characters gets renamed; the
// renamed file then advances to `staged/`.
void test("A card with whitespace or shell-unsafe characters gets renamed; the renamed f...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/Voice Note (raw).doc.card", "<doc/>");

  const result = await runIntake({ boxRoot: box.root });

  t.check(result, {
    routed: ["Voice Note (raw).doc.card"],
    applied: [{ step: "filename-normalization", file: "Voice Note (raw).doc.card", newName: "Voice_Note_raw.doc.card" }],
    staged: ["Voice_Note_raw.doc.card"],
  });
});

// ## Reserved subdirs are skipped
//
// Items already sitting in `intake/`, `staged/`, or `triaged/` aren't
// re-routed, and items in unrecognized subdirectories are left alone too.
void test("Items already sitting in intake/, staged/, or triaged/ aren't re-routed, and...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/Fresh.doc.card", "<doc/>");
  await box.write("_content/inbox/oldbucket/Legacy.doc.card", "<doc/>");
  await box.write("_content/inbox/staged/Already.doc.card", "<doc/>");

  const result = await runIntake({ boxRoot: box.root });

  t.check(result, { routed: ["Fresh.doc.card"], applied: [], staged: ["Fresh.doc.card"] });

  t.check(await box.read("_content/inbox/oldbucket/Legacy.doc.card"), "<doc/>");

  t.check(await box.read("_content/inbox/staged/Already.doc.card"), "<doc/>");
});

// ## Non-card top-level files stay put
//
// `_content/inbox/AGENTS.md`, `MAP.md`, README files, and similar agent-facing
// context don't get swept into intake. Only `*.card` files are routed.
void test("content/inbox/AGENTS.md, MAP.md, README files, and similar agent-facing conte...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/AGENTS.md", "# Inbox context");
  await box.write("_content/inbox/MAP.md", "# Inbox map");
  await box.write("_content/inbox/Note.doc.card", "<doc/>");

  const result = await runIntake({ boxRoot: box.root });

  t.check(result, { routed: ["Note.doc.card"], applied: [], staged: ["Note.doc.card"] });

  t.check(await box.read("_content/inbox/AGENTS.md"), "# Inbox context");

  t.check(await box.read("_content/inbox/MAP.md"), "# Inbox map");
});

// ## Empty inbox is a no-op
void test("Empty inbox is a no-op", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();

  const result = await runIntake({ boxRoot: box.root });

  t.check(result, {
    routed: [],
    applied: [],
    staged: [],
  });
});

// ## Attachments follow all three transitions
//
// Arrival, filename normalization, and advancement move the owned scope. A target
// scope collision leaves the arrival and both scopes intact.
void test("Arrival, filename normalization, and advancement move the owned scope.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/House Notice.doc.card", "Household notice");
  await box.write("_content/inbox/House Notice.attach/nested/notice.txt", "Attachment evidence");
  const moved = await runIntake({ boxRoot: box.root });
  t.check(moved, {
    routed: ["House Notice.doc.card"],
    applied: [{ step: "filename-normalization", file: "House Notice.doc.card", newName: "House_Notice.doc.card" }],
    staged: ["House_Notice.doc.card"],
  });

  await t.checkText(await box.list("_content/inbox/staged"), `_content/inbox/staged/.gitkeep
_content/inbox/staged/House_Notice.attach
_content/inbox/staged/House_Notice.attach/nested
_content/inbox/staged/House_Notice.attach/nested/notice.txt
_content/inbox/staged/House_Notice.doc.card`);

  await box.write("_content/inbox/Blocked.doc.card", "Do not move");
  await box.write("_content/inbox/Blocked.attach/original.txt", "Original");
  await box.write("_content/inbox/intake/Blocked.attach/other.txt", "Existing target");
  const blocked = await runIntake({ boxRoot: box.root });
  t.check(blocked, { routed: [], applied: [], staged: [] });

  await t.checkText(await box.list("_content/inbox"), `_content/inbox/.gitkeep
_content/inbox/Blocked.attach
_content/inbox/Blocked.attach/original.txt
_content/inbox/Blocked.doc.card
_content/inbox/intake
_content/inbox/intake/.gitkeep
_content/inbox/intake/Blocked.attach
_content/inbox/intake/Blocked.attach/other.txt
_content/inbox/staged
_content/inbox/staged/.gitkeep
_content/inbox/staged/House_Notice.attach
_content/inbox/staged/House_Notice.attach/nested
_content/inbox/staged/House_Notice.attach/nested/notice.txt
_content/inbox/staged/House_Notice.doc.card
_content/inbox/triaged
_content/inbox/triaged/.gitkeep
_content/inbox/triaged/_unsure
_content/inbox/triaged/_unsure/.gitkeep
_content/inbox/unhandled
_content/inbox/unhandled/.gitkeep`);
});
