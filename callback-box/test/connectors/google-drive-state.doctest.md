# Google Drive transient-state delta merge

`config/connectors/google-drive.state.json` is written by TWO processes — the
server `sync()` and the CLI `cb drive add`. Neither holds the cross-process lock
for its whole run; each loads state, threads it by reference, and at the save
point delta-merges its per-file changes into FRESHLY-loaded state via
`commitDriveStateDelta` (`mergeDriveState`). A file one writer never touched
survives the other's save.

```ts setup
import {
  mergeDriveState,
  commitDriveStateDelta,
  emptyFileState,
  type DriveTransientState,
} from "../../src/connectors/google-drive-state.js";
import { updateTransientState, loadTransientState } from "../../src/connectors/transient-state.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

function fileState(lastModified: string): ReturnType<typeof emptyFileState> {
  const s = emptyFileState();
  s.lastModified = lastModified;
  return s;
}
```

## mergeDriveState — per-key resolution

A sync that updated file `A` and discovered new file `C`, merged against fresh
state that a concurrent `cb drive add` grew with file `B`: `A` takes the sync's
newer value (it differs from the snapshot the sync loaded), `B` is preserved
from fresh (the sync never saw it), `C` is added.

```ts
const snapshot: DriveTransientState = { files: { A: fileState("t0") } };
const fresh: DriveTransientState = { files: { A: fileState("t0"), B: fileState("cli") } };
const working: DriveTransientState = { files: { A: fileState("t1-updated"), C: fileState("new") } };
const merged = mergeDriveState({ fresh, snapshot, working });
JSON.stringify({
  A: merged.files["A"]?.lastModified,
  B: merged.files["B"]?.lastModified,
  C: merged.files["C"]?.lastModified,
})
=> {"A":"t1-updated","B":"cli","C":"new"}
```

A file the sync merely READ (identical to its snapshot) defers to fresh, so a
concurrent writer's update to that same key is NOT clobbered.

```ts continue
const snap2: DriveTransientState = { files: { A: fileState("t0") } };
const fresh2: DriveTransientState = { files: { A: fileState("concurrent-edit") } };
const working2: DriveTransientState = { files: { A: fileState("t0") } };
mergeDriveState({ fresh: fresh2, snapshot: snap2, working: working2 }).files["A"]?.lastModified
=> concurrent-edit
```

## End-to-end — concurrent CLI add survives the server sync's delta save

The server loads `{ A }`, snapshots it, then does its work. Meanwhile the CLI
adds `B` (its own locked delta write). The server finishes, having updated `A`
and discovered `C`, and delta-saves. All three land: `A` is the server's update,
`B` survives, `C` is new.

```ts
const box = await makeTmpBox();

// Server's initial load + snapshot.
await updateTransientState<DriveTransientState>({
  boxRoot: box.root, connectorName: "google-drive", defaultValue: { files: {} },
  update: () => ({ files: { A: fileState("t0") } }),
});
const serverWorking: DriveTransientState = { files: { A: fileState("t0") } };
const serverSnapshot: DriveTransientState = structuredClone(serverWorking);

// Concurrent CLI `cb drive add B` — a locked delta write against fresh state.
await updateTransientState<DriveTransientState>({
  boxRoot: box.root, connectorName: "google-drive", defaultValue: { files: {} },
  update: (freshState) => ({ files: { ...freshState.files, B: fileState("cli") } }),
});

// Server finishes: updates A in place, discovers C, delta-saves.
serverWorking.files["A"] = fileState("t1-updated");
serverWorking.files["C"] = fileState("new");
await commitDriveStateDelta({ boxRoot: box.root, snapshot: serverSnapshot, working: serverWorking });

const onDisk = await loadTransientState<DriveTransientState>({
  boxRoot: box.root, connectorName: "google-drive", defaultValue: { files: {} },
});
JSON.stringify({
  A: onDisk.files["A"]?.lastModified,
  B: onDisk.files["B"]?.lastModified,
  C: onDisk.files["C"]?.lastModified,
})
=> {"A":"t1-updated","B":"cli","C":"new"}
```

```ts cleanup
await box.cleanup();
```
