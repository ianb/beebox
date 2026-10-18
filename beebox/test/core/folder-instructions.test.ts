// # Folder instruction notes
//
// `folderInstructionNotes(boxRoot, cardPath)` names the instruction files that
// apply to a new card: those in its directory and the ancestors below the box
// root, nearest first. The root file is always loaded, so it is not listed.
// Files holding only `@` includes (a map-only stub) are skipped.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { folderInstructionNotes } from "../../src/core/folder-instructions.js";

const box = await makeTmpBox({ git: "none" });
async function put(rel: string, content: string) {
  await mkdir(join(box.root, rel, ".."), { recursive: true });
  await writeFile(join(box.root, rel), content);
}

// ## No files
void test("No files", async (t) => {
  // doctest:L24
  t.check(await folderInstructionNotes(box.root, "_content/people/Priya_Marlowe.person.card"), []);

  // ## Root file is not listed

  // doctest:L31
  await put("AGENTS.md", "Root rules.\n");
  t.check(await folderInstructionNotes(box.root, "_content/people/Priya_Marlowe.person.card"), []);

  // ## Nested file with real content

  // doctest:L39
  await put("_content/people/AGENTS.md", "# People\nUse full names.\n");
  t.check(await folderInstructionNotes(box.root, "_content/people/Priya_Marlowe.person.card"), [
    "Folder instructions: _content/people/AGENTS.md. Read it before filling in this card.",
  ]);

  // ## Map-only stub is skipped

  // doctest:L47
  await put("_content/AGENTS.md", "\n@MAP.md\n\n");
  t.check(await folderInstructionNotes(box.root, "_content/people/Priya_Marlowe.person.card"), [
    "Folder instructions: _content/people/AGENTS.md. Read it before filling in this card.",
  ]);

  // ## Both names, and two levels
  //
  // An unconverted box uses `CLAUDE.md`. Instructions at both levels list nearest
  // first, and an absolute card path works.

  // doctest:L58
  await put("_content/people/CLAUDE.md", "Legacy people rules.\n");
  await put("_content/AGENTS.md", "@MAP.md\nContent rules.\n");
  t.check(await folderInstructionNotes(box.root, join(box.root, "_content/people/Priya_Marlowe.person.card")), [
    "Folder instructions: _content/people/CLAUDE.md. Read it before filling in this card.",
    "Folder instructions: _content/people/AGENTS.md. Read it before filling in this card.",
    "Folder instructions: _content/AGENTS.md. Read it before filling in this card.",
  ]);

  // ## The legacy mirror symlink is not named twice
  //
  // In a box not yet migrated, `AGENTS.md` beside a `CLAUDE.md` is a symlink to it
  // (the Codex mirror). Only the `CLAUDE.md` is named.

  // doctest:L74
  await rm(join(box.root, "_content/AGENTS.md"));
  await put("_content/CLAUDE.md", "Content rules.\n");
  await symlink("CLAUDE.md", join(box.root, "_content/AGENTS.md"));
  t.check(await folderInstructionNotes(box.root, "_content/people/Priya_Marlowe.person.card"), [
    "Folder instructions: _content/people/CLAUDE.md. Read it before filling in this card.",
    "Folder instructions: _content/people/AGENTS.md. Read it before filling in this card.",
    "Folder instructions: _content/CLAUDE.md. Read it before filling in this card.",
  ]);
});
