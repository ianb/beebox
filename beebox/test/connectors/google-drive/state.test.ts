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

/** State with both fields present, the way every load hands it out. */
function driveState(opts: {
  files: Record<string, ReturnType<typeof emptyFileState>>;
  driveTrashed?: string[];
}): DriveTransientState {
  return { files: opts.files, driveTrashed: opts.driveTrashed ?? [] };
}

// ## mergeDriveState — per-key resolution
//
// A sync that updated file `A` and discovered new file `C`, merged against fresh
// state that a concurrent `bbx drive add` grew with file `B`: `A` takes the sync's
// newer value (it differs from the snapshot the sync loaded), `B` is preserved
// from fresh (the sync never saw it), `C` is added.
void test("A sync that updated file A and discovered new file C, merged against fresh st...", async (t) => {
  // doctest:L44
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

  // doctest:L60
  const snap2 = driveState({ files: { A: fileState("t0") } });
  const fresh2 = driveState({ files: { A: fileState("concurrent-edit") } });
  const working2 = driveState({ files: { A: fileState("t0") } });
  t.check(mergeDriveState({ fresh: fresh2, snapshot: snap2, working: working2 }).files["A"]?.lastModified, "concurrent-edit");

  // ## mergeDriveState — `driveTrashed` is a set, added to and removed from
  //
  // The IDs the connector itself trashed are merged as a set: this writer's
  // additions land, this writer's removals (an ID whose card it just re-created)
  // are honoured, and an ID a concurrent writer added survives untouched.

  // doctest:L74
  const snap3 = driveState({ files: {}, driveTrashed: ["gone", "restored"] });
  const fresh3 = driveState({ files: {}, driveTrashed: ["gone", "restored", "concurrent"] });
  const working3 = driveState({ files: {}, driveTrashed: ["gone", "newly-trashed"] });
  t.check(mergeDriveState({ fresh: fresh3, snapshot: snap3, working: working3 }).driveTrashed, [
    "concurrent",
    "gone",
    "newly-trashed",
  ]);
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
  // doctest:L89
  const box = await makeTmpBox();

  // doctest:L91
  // Server's initial load + snapshot.
  await updateTransientState<DriveTransientState>({
    boxRoot: box.root, connectorName: "google-drive", defaultValue: driveState({ files: {} }),
    update: () => driveState({ files: { A: fileState("t0") } }),
  });
  const serverWorking = driveState({ files: { A: fileState("t0") } });
  const serverSnapshot: DriveTransientState = structuredClone(serverWorking);

  // doctest:L99
  // Concurrent CLI `bbx drive add B` — a locked delta write against fresh state.
  await updateTransientState<DriveTransientState>({
    boxRoot: box.root, connectorName: "google-drive", defaultValue: driveState({ files: {} }),
    update: (freshState) => driveState({ files: { ...freshState.files, B: fileState("cli") } }),
  });

  // doctest:L105
  // Server finishes: updates A in place, discovers C, delta-saves.
  serverWorking.files["A"] = fileState("t1-updated");
  serverWorking.files["C"] = fileState("new");
  await commitDriveStateDelta({ boxRoot: box.root, snapshot: serverSnapshot, working: serverWorking });

  // doctest:L110
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
