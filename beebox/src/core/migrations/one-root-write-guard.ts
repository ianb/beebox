/**
 * Round-7 hardening finding 1(b): a single guard every WRITE the `one-root`
 * migration itself performs on an existing box-relative path calls before
 * touching the file — `fs.writeFile` (and, for durability, `writeFileAtomic`'s
 * temp-then-rename) both happily follow a symlinked TARGET, so a tracked
 * `CLAUDE.md -> /shared/persona.md` would otherwise have the box's persona
 * merge written straight through it into `/shared/persona.md` — data leaving
 * the box's own git history with no record and no way for rollback to undo
 * it. Round 6 closed exactly that one instance (a symlinked `CLAUDE.md`); this
 * closes the class: every write site in `one-root-*.ts` that mutates a path
 * which might already exist (the CLAUDE.md merge target, the `.beebox/box.json`
 * marker, the merged `.gitignore`/`.gitattributes`, the chat-binding history
 * file, the external hub/boxes manifests) calls this first.
 *
 * `lstat`s the target and aborts (mirroring a preflight refusal — nothing has
 * been written yet) if it already exists AND is a symlink. A missing target
 * (ENOENT) is the ordinary "first write" case and passes through.
 */

import * as fs from "node:fs/promises";
import { errnoCode } from "../../lib/error-guards.js";
import { OneRootPreflightError } from "./one-root-errors.js";

export async function assertWriteTargetNotSymlink(absPath: string): Promise<void> {
  const lst = await fs.lstat(absPath).catch((e: unknown) => {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  });
  if (lst !== null && lst.isSymbolicLink()) {
    throw new OneRootPreflightError(
      `${absPath} is a symlink — refusing to write through it (this would land the migration's bytes at ` +
        "wherever the link points, outside the box's own git history). Reconcile by hand (replace the symlink " +
        "with a real file, or move its contents in), then re-run.",
    );
  }
}
