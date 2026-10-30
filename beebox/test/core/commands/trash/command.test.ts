// # `bbx rm` — trash cards, with a real dry-run
//
// The trash command moves cards (plus their `.attach/` directories) into the
// box's trash. `--dry-run` reports what would move without touching anything —
// this test pins that contract, because the flag was once advertised by the
// CLI while the command silently ignored it and trashed the files anyway.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { executeTrash, moveCardsToTrash, withCollisionStamp } from "../../../../src/core/commands/trash/command.js";
import { rollbackTrashReceipt } from "../../../../src/core/chat/session/delete/trash-recovery.js";
import { createCollectorContext } from "../../../../src/core/command-runner.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import type { TmpBox } from "../../../helpers/test-helpers.js";
import { isRecord } from "../../../../src/shared/is-record.js";

/** A directory listing without scaffolding: `.gitkeep` files and the empty directories that hold only one. */
async function ls(box: TmpBox, dir: string) {
  const lines = (await box.list(dir)).split("\n");
  return lines.filter((l: string) => !l.endsWith("/.gitkeep") && !lines.includes(`${l}/.gitkeep`)).join("\n");
}

async function rm(box: TmpBox, args: Record<string, unknown>) {
  const { ctx } = createCollectorContext(box.root);
  return executeTrash(ctx, args);
}

// ## Dry run: reports, mutates nothing
void test("Dry run: reports, mutates nothing", async (t) => {
  const box = await makeTmpBox();
  await box.write(
    "_content/box/notes/Engine.doc.card",
    "---\ntype: doc\ntitle: Engine\n---\nBody.\n",
  );

  const dry = await rm(box, { paths: ["_content/box/notes/Engine.doc.card"], dryRun: true });
  t.check(dry.data, {
    dryRun: true,
    wouldTrash: [
      "_content/box/notes/Engine.doc.card",
    ],
    errors: [],
    inboundRefs: {
      "_content/box/notes/Engine.doc.card": [],
    },
  });

  // The card is still in place:

  t.check(await box.list("_content/box/notes"), "_content/box/notes/Engine.doc.card");

  // A dry run against a missing card fails without creating anything:

  const missing = await rm(box, { paths: ["_content/box/notes/Nope.doc.card"], dryRun: true });
  t.check(missing, { success: false, error: "Card not found: _content/box/notes/Nope.doc.card" });

  // ## Real run: the card moves to trash

  const real = await rm(box, { paths: ["_content/box/notes/Engine.doc.card"] });
  t.check(real, {
    success: true,
    data: { sourcePath: "_content/box/notes/Engine.doc.card", destPath: "_bookkeeping/trash/Engine.doc.card", relatedFiles: [], inboundRefs: [] },
  });

  t.check(await ls(box, "_bookkeeping/trash"), "_bookkeeping/trash/Engine.doc.card");

  t.check(await box.list("_content/box/notes"), "");

  // ## Round-8 hardening finding 4: a symlinked trash directory refuses, nothing moves
  //
  // `_bookkeeping/trash -> ../src` — a symlink pointing at the box's own source
  // tree — would otherwise let an ordinary trash rename land a card in `src/`
  // instead of the trash. `getBoxDir`/`fs.rename` alone never check this; the
  // destination is now resolved through the box-namespace fence's on-disk check
  // before any rename.

  const escapeBox = await makeTmpBox();
  await escapeBox.write("_content/box/notes/Escape.doc.card", "---\ntype: doc\ntitle: Escape\n---\nBody.\n");
  await fs.rm(path.join(escapeBox.root, "_bookkeeping", "trash"), { recursive: true, force: true });
  await fs.symlink("../src", path.join(escapeBox.root, "_bookkeeping", "trash"));

  const escapeResult = await rm(escapeBox, { paths: ["_content/box/notes/Escape.doc.card"] });
  t.check(escapeResult, {
    success: false,
    error: "Trash destination escapes the box's data namespace: _bookkeeping/trash/Escape.doc.card",
  });

  // The card never moved, and nothing landed in `src/`:

  t.check(await escapeBox.list("_content/box/notes"), "_content/box/notes/Escape.doc.card");

  const srcFiles = await fs.readdir(path.join(escapeBox.root, "src"));
  t.check(srcFiles, ["schemas", "tricks", "views"]);
});

// ## Inbound refs are resolved from each referring document
//
// The report comes from the same scanner as `bbx mv`, so relative refs and refs
// into the card's attach scope are included without changing the referrers.
void test("The report comes from the same scanner as bbx mv, so relative refs and refs i...", async (t) => {
  const linked = await makeTmpBox();
  await linked.write("_content/box/notes/Target.doc.card", "---\ntype: doc\ntitle: Target\n---\n");
  await linked.write("_content/box/notes/Source.doc.card", "---\ntype: doc\nrefs:\n  - Target.doc.card\n---\n[attachment](Target.attach/photo.png)\n");
  await linked.write("_content/box/Index.md", "[target](notes/Target.doc.card)\n");
  await linked.write("_bookkeeping/trash/Old.doc.card", "---\ntype: doc\n---\n[old](../../_content/box/notes/Target.doc.card)\n");
  await linked.write("_content/box/Fenced.md", "```md\n[example](notes/Target.doc.card)\n```\n");

  const report = await rm(linked, { paths: ["_content/box/notes/Target.doc.card"], dryRun: true });
  t.check(isRecord(report.data) ? report.data["inboundRefs"] : undefined, {
    "_content/box/notes/Target.doc.card": [
      {
        path: "_content/box/Index.md",
        refs: 1,
      },
      {
        path: "_content/box/notes/Source.doc.card",
        refs: 2,
      },
    ],
  });

  await t.checkText(await linked.read("_content/box/notes/Source.doc.card"), `---
type: doc
refs:
  - Target.doc.card
---
[attachment](Target.attach/photo.png)`);
});

// ## A failed commit can roll the move back
//
// The UI uses the receipt to restore both the card and its attach scope when its
// git commit fails, rather than reporting total failure after a completed move.
void test("The UI uses the receipt to restore both the card and its attach scope when it...", async (t) => {
  const rollback = await makeTmpBox({ git: true });
  await rollback.write("_content/inbox/Rollback.doc.card", "---\ntype: doc\n---\n");
  await rollback.write("_content/inbox/Rollback.attach/file.txt", "attached");
  await rollback.commitAll("seed rollback card");
  const { ctx: rollbackCtx } = createCollectorContext(rollback.root);
  const receipt = await moveCardsToTrash(rollbackCtx, ["_content/inbox/Rollback.doc.card"]);
  await rollbackTrashReceipt(rollback.root, receipt);
  t.check(({ inbox: await ls(rollback, "_content/inbox"), trash: await ls(rollback, "_bookkeeping/trash") }), {
    inbox: `_content/inbox/Rollback.attach
_content/inbox/Rollback.attach/file.txt
_content/inbox/Rollback.doc.card`,
    trash: "",
  });
});

// ## A never-committed card can still be trashed and committed
void test("A never-committed card can still be trashed and committed", async (t) => {
  const untracked = await makeTmpBox({ git: true });
  await untracked.write("_content/inbox/New.doc.card", "---\ntype: doc\n---\n");
  const trashed = await rm(untracked, { paths: ["_content/inbox/New.doc.card"], commit: true });
  t.check(({ result: trashed, trash: await ls(untracked, "_bookkeeping/trash"), git: await import("simple-git").then(({ simpleGit }) => simpleGit(untracked.root).log().then((log) => log.latest?.message)) }), {
    result: {
      success: true,
      data: { sourcePath: "_content/inbox/New.doc.card", destPath: "_bookkeeping/trash/New.doc.card", relatedFiles: [], inboundRefs: [] },
    },
    trash: "_bookkeeping/trash/New.doc.card",
    git: "Trash card: New.doc.card",
  });
});

// ## A display-form path argument is rejected, not treated as a file path
//
// `Config:box.json` (the boxholder's display vocabulary) is rejected with a
// message naming the canonical form, rather than silently treated as (and
// failing to find) a relative file named `Config:box.json`
// (`docs/plans/display-path-guard.subplan.md`):
void test("Config:box.json (the boxholder's display vocabulary) is rejected with a messa...", async (t) => {
  const dbox = await makeTmpBox();
  const rejected = await rm(dbox, { paths: ["Config:box.json"] });
  t.check(rejected, {
    success: false,
    error: "`Config:box.json` is the boxholder's display form; write `/_config/box.json`",
  });
});

// ## A name collision in the trash keeps the card's ending
//
// The stamp goes after the attach stem, so a job card still ends in
// `.job.card` (the reactor finds jobs by that ending) and its attach directory
// is `<stem>_<stamp>.attach`. A positional card keeps its type.
void test("withCollisionStamp keeps the card ending for nominal, job, and positional cards", async (t) => {
  t.check(["Notes.doc.card", "Inbox.intake.job.card", "nav.card"].map((name) => withCollisionStamp(name, "S")), [
    "Notes_S.doc.card",
    "Inbox.intake_S.job.card",
    "nav_S.nav.card",
  ]);
});
