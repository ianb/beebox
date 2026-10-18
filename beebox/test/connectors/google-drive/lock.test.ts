// # The Drive mirror lock
//
// One writer at a time over a box's Drive mirror. `bbx drive mount` from a chat
// agent and `bbx wakeup`'s connector sync are two processes that can both be
// discovering, creating, and pushing the same newly-listed Drive child; the
// delta-merge in `google-drive-state.ts` keeps the state *file* consistent but
// does nothing about the duplicated work, so the span itself is exclusive.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { initBox } from "../../../src/core/box/structure/core.js";
import { inspectLock } from "../../../src/lib/file-lock.js";
import { withDriveMirrorLock } from "../../../src/connectors/google-drive/lock.js";
import { mountDriveFolder } from "../../../src/connectors/google-drive/mounts/core.js";
import { createFakeGoogleDrive, type DriveFile } from "../../../src/services/google-drive/core.js";
import * as path from "node:path";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function driveFile(opts: { id: string; name: string; mimeType: string; parent?: string }): DriveFile {
  return {
    id: opts.id,
    name: opts.name,
    mimeType: opts.mimeType,
    modifiedTime: "2026-08-26T10:00:00Z",
    trashed: false,
    owners: [{ emailAddress: "test@example.com" }],
    ...(opts.parent === undefined ? {} : { parents: [opts.parent] }),
    webViewLink: `https://drive.google.com/file/d/${opts.id}/view`,
  };
}

// ## A second entrant waits for the first
//
// The second span does not start until the first has finished — not interleaved,
// not refused.
void test("The second span does not start until the first has finished — not interleaved...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L44
  const box = await makeTmpBox({ git: true });
  const order: string[] = [];

  // doctest:L47
  const first = withDriveMirrorLock(box.root, async () => {
    order.push("first in");
    await pause(120);
    order.push("first out");
  });
  // Long enough for the first to be holding the lock before the second asks.
  await pause(20);
  const second = withDriveMirrorLock(box.root, async () => {
    order.push("second in");
    order.push("second out");
  });
  await Promise.all([first, second]);
  t.check(order.join(" · "), "first in · first out · second in · second out");

  // The lock is released when the span ends, including when it throws.

  // doctest:L66
  const failed = withDriveMirrorLock(box.root, () => Promise.reject(new Error("mirror blew up")));
  t.check(await failed.catch((e: unknown) => (e instanceof Error ? e.message : String(e))), "mirror blew up");

  // doctest:L70
  t.check(await inspectLock(path.join(box.root, ".beebox", "drive-mirror.lock")), null);

  // ## Nesting passes through instead of deadlocking
  //
  // `bbx drive mount` holds the span and calls `mirrorFolderOnce`, which wants the
  // same lock. That is ordinary composition — the outer holder already has the
  // exclusion the inner call wants — so a nested acquisition returns immediately
  // rather than queueing behind its own ancestor.

  // doctest:L82
  t.check(
    await withDriveMirrorLock(box.root, () =>
      withDriveMirrorLock(box.root, () =>
        withDriveMirrorLock(box.root, () => Promise.resolve("three deep, no deadlock")),
      ),
    ),
    "three deep, no deadlock",
  );
});

// ## A mount really holds it, across its mirror pass
//
// Not a property of the helper alone: the lock is observably held while the
// mirror is talking to Drive, which is the window a concurrent wakeup sync would
// otherwise walk into.
void test("Not a property of the helper alone:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L101
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const lockPath = path.join(box.root, ".beebox", "drive-mirror.lock");

  // doctest:L105
  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "pdf-1", name: "Scan.pdf", mimeType: "application/pdf", parent: "folder-1" }),
    ],
  });
  const heldDuringListing: boolean[] = [];
  const watched = {
    ...drive,
    listFiles: async (folderId: string) => {
      heldDuringListing.push((await inspectLock(lockPath)) !== null);
      return drive.listFiles(folderId);
    },
  };

  // doctest:L120
  const mounted = await mountDriveFolder({
    boxRoot: box.root,
    service: watched,
    input: "https://drive.google.com/drive/folders/folder-1",
    dir: "_content/drive/recipes",
  });
  t.check({ cardPath: mounted.cardPath, heldDuringListing }, {
    cardPath: "_content/drive/recipes/Recipes.gfolder.card",
    heldDuringListing: [
      true,
    ],
  });

  // And it is not still held once the mount returns.

  // doctest:L133
  t.check(await inspectLock(lockPath), null);
});
