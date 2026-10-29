// # Google Drive transient-state delta merge
//
// `_bookkeeping/connectors/google-drive.state.json` is written by TWO processes — the
// server `sync()` and the CLI `bbx drive add`. Neither holds the cross-process lock
// for its whole run; each loads state, threads it by reference, and at the save
// point delta-merges its per-file changes into FRESHLY-loaded state via
// `commitDriveStateDelta` (`mergeDriveState`). A file one writer never touched
// survives the other's save.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  mergeDriveState,
  commitDriveStateDelta,
  emptyFileState,
  loadDriveState,
  type DriveTransientState,
} from "../../../src/connectors/google-drive/state.js";
import { updateTransientState } from "../../../src/transient-state.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

function fileState(lastModified: string): ReturnType<typeof emptyFileState> {
  const s = emptyFileState();
  s.lastModified = lastModified;
  return s;
}

/** State with every field present, the way every load hands it out. */
function driveState(opts: {
  files: Record<string, ReturnType<typeof emptyFileState>>;
  driveTrashed?: string[];
  folders?: DriveTransientState["folders"];
}): DriveTransientState {
  return { files: opts.files, driveTrashed: opts.driveTrashed ?? [], folders: opts.folders ?? {} };
}

// ## mergeDriveState — per-key resolution
//
// A sync that updated file `A` and discovered new file `C`, merged against fresh
// state that a concurrent `bbx drive add` grew with file `B`: `A` takes the sync's
// newer value (it differs from the snapshot the sync loaded), `B` is preserved
// from fresh (the sync never saw it), `C` is added.
void test("A sync that updated file A and discovered new file C, merged against fresh st...", async (t) => {
  const snapshot = driveState({ files: { A: fileState("t0") } });
  const fresh = driveState({ files: { A: fileState("t0"), B: fileState("cli") } });
  const working = driveState({ files: { A: fileState("t1-updated"), C: fileState("new") } });
  const merged = mergeDriveState({ fresh, snapshot, working });
  t.check(
    {
      A: merged.files["A"]?.lastModified,
      B: merged.files["B"]?.lastModified,
      C: merged.files["C"]?.lastModified,
    },
    {
    A: "t1-updated",
    B: "cli",
    C: "new",
  },
  );

  // A file the sync merely READ (identical to its snapshot) defers to fresh, so a
  // concurrent writer's update to that same key is NOT clobbered.

  const snap2 = driveState({ files: { A: fileState("t0") } });
  const fresh2 = driveState({ files: { A: fileState("concurrent-edit") } });
  const working2 = driveState({ files: { A: fileState("t0") } });
  t.check(mergeDriveState({ fresh: fresh2, snapshot: snap2, working: working2 }).files["A"]?.lastModified, "concurrent-edit");

  // ## mergeDriveState — `driveTrashed` is a set, added to and removed from
  //
  // The IDs the connector itself trashed are merged as a set: this writer's
  // additions land, this writer's removals (an ID whose card it just re-created)
  // are honoured, and an ID a concurrent writer added survives untouched.

  const snap3 = driveState({ files: {}, driveTrashed: ["gone", "restored"] });
  const fresh3 = driveState({ files: {}, driveTrashed: ["gone", "restored", "concurrent"] });
  const working3 = driveState({ files: {}, driveTrashed: ["gone", "newly-trashed"] });
  t.check(mergeDriveState({ fresh: fresh3, snapshot: snap3, working: working3 }).driveTrashed, [
    "concurrent",
    "gone",
    "newly-trashed",
  ]);

  // ## mergeDriveState — `folders` resolves per key, like `files`
  //
  // "Sync now" mirrored folder F1 while a wakeup sync in another process
  // mirrored F2 and saved first: each pass's own time lands, and F3, which this
  // writer only read, keeps the time the other writer gave it.

  const at = (lastSync: string) => ({ lastSync });
  const snap4 = driveState({ files: {}, folders: { F1: at("t0"), F3: at("t0") } });
  const fresh4 = driveState({ files: {}, folders: { F1: at("t0"), F2: at("t2"), F3: at("t3") } });
  const working4 = driveState({ files: {}, folders: { F1: at("t1"), F3: at("t0") } });
  t.check(mergeDriveState({ fresh: fresh4, snapshot: snap4, working: working4 }).folders, {
    F1: at("t1"),
    F2: at("t2"),
    F3: at("t3"),
  });
});

// ## End-to-end — concurrent CLI add survives the server sync's delta save
//
// The server loads `{ A }`, snapshots it, then does its work. Meanwhile the CLI
// adds `B` (its own locked delta write). The server finishes, having updated `A`
// and discovered `C`, and delta-saves. All three land: `A` is the server's update,
// `B` survives, `C` is new.
void test("The server loads { A }, snapshots it, then does its work.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();

  // Server's initial load + snapshot.
  await updateTransientState<DriveTransientState>({
    boxRoot: box.root, connectorName: "google-drive", defaultValue: driveState({ files: {} }),
    update: () => driveState({ files: { A: fileState("t0") } }),
  });
  const serverWorking = driveState({ files: { A: fileState("t0") } });
  const serverSnapshot: DriveTransientState = structuredClone(serverWorking);

  // Concurrent CLI `bbx drive add B` — a locked delta write against fresh state.
  await updateTransientState<DriveTransientState>({
    boxRoot: box.root, connectorName: "google-drive", defaultValue: driveState({ files: {} }),
    update: (freshState) => driveState({ files: { ...freshState.files, B: fileState("cli") } }),
  });

  // Server finishes: updates A in place, discovers C, delta-saves.
  serverWorking.files["A"] = fileState("t1-updated");
  serverWorking.files["C"] = fileState("new");
  await commitDriveStateDelta({ boxRoot: box.root, snapshot: serverSnapshot, working: serverWorking });

  const onDisk = await loadDriveState(box.root);
  t.check(
    {
      A: onDisk.files["A"]?.lastModified,
      B: onDisk.files["B"]?.lastModified,
      C: onDisk.files["C"]?.lastModified,
    },
    {
    A: "t1-updated",
    B: "cli",
    C: "new",
  },
  );
});

// ## A box with no state file gets its own empty state
//
// A missing file loads the shared default, and a sync writes into the loaded
// maps in place. Without fresh containers, one box's folder sync time would
// show up in the next box that has no state file, in the same server process.
void test("Two boxes with no state file do not share what one of them records", async (t) => {
  const one = await makeTmpBox();
  const two = await makeTmpBox();
  t.teardown(async () => {
    await one.cleanup();
    await two.cleanup();
  });
  const first = await loadDriveState(one.root);
  first.folders["folder-1"] = { lastSync: "2026-10-29T12:00:00.000Z" };
  first.files["doc-1"] = emptyFileState();
  first.driveTrashed.push("gone");
  t.check(await loadDriveState(two.root), { files: {}, driveTrashed: [], folders: {} });
});
