// # Git history filtered by card path
//
// Path history follows a card through a rename and remains available after the
// current path is deleted. This is the shared contract behind the card action
// menu and the useful missing-card state.

import { test } from "tap";
import "agent-doctest/tap";
import { rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getLogPaginated } from "../../src/lib/git/core/operations.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

void test("line 14", async (t) => {
  // doctest:L15
  const box = await makeTmpBox({ git: true });
  await box.write("_content/notes/Original.doc.card", "---\ntype: doc\ntitle: Original\n---\n");
  await box.commitAll("Create original");
  await rename(join(box.root, "_content/notes/Original.doc.card"), join(box.root, "_content/notes/Renamed.doc.card"));
  await box.commitAll("Rename card");

  // doctest:L21
  const beforeDelete = await getLogPaginated({ boxRoot: box.root, filter: { path: "_content/notes/Renamed.doc.card" } });
  t.check(beforeDelete.map((commit) => commit.subject).join(" | "), "Rename card | Create original");

  // doctest:L25
  await unlink(join(box.root, "_content/notes/Renamed.doc.card"));
  await box.commitAll("Delete card");
  const afterDelete = await getLogPaginated({ boxRoot: box.root, filter: { path: "_content/notes/Renamed.doc.card" } });
  t.check(afterDelete.map((commit) => commit.subject).join(" | "), "Delete card | Rename card | Create original");
});
