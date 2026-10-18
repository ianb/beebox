// # file-readable: tell a file that can't be read from a failed upload
//
// A picked `File` is a handle on the disk. If the file is moved or deleted
// after the pick, every read fails, and an upload of it fails inside the
// transfer as a "network error". `assertReadable` reads the first chunk first
// so the caller can say what actually happened.

import { test } from "tap";
import "agent-doctest/tap";
import { assertReadable, UnreadableFileError } from "../../src/lib/file-readable.js";
import { errorMessage } from "../../../shared/error-guards.js";

// A readable blob passes, and so does an empty one:
void test("A readable blob passes, and so does an empty one:", async (t) => {
  // doctest:L15
  await assertReadable(new Blob(["photo bytes"]), { name: "shelf.jpg" });
  await assertReadable(new Blob([]), { name: "empty.txt" });
  t.check("ok", "ok");
});

// A blob whose stream errors on read, the way a deleted file's does in a
// browser (even when the browser reports its size as 0), is unreadable:
void test("A blob whose stream errors on read, the way a deleted file's does in a browse...", async (t) => {
  // doctest:L25
  const gone = Object.assign(new Blob([]), {
    stream: () => new ReadableStream({ pull(c) { c.error(new TypeError("network error")); } }),
  });
  let caught: unknown;
  try { await assertReadable(gone, { name: "shelf.jpg" }); } catch (e) { caught = e; }
  t.check([caught instanceof UnreadableFileError, errorMessage(caught)], [
    true,
    "shelf.jpg can't be read. It may have been moved or deleted since it was picked.",
  ]);
});
