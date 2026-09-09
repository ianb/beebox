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
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";
import { OneRootPreflightError } from "./one-root-errors.js";
import { MANIFEST_PATH } from "../migrations.js";

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

/** v2's manifest lived at `content/config/migrations.jsonl` — no underscore
 * fence, unlike every v3-relative path (`MANIFEST_PATH` itself). */
const V2_MANIFEST_REL = "config/migrations.jsonl";

/**
 * Round-8 hardening finding 1: every one of THESE specific paths gets written
 * through by a migration callee before the CLAUDE.md-merge/marker-bump call
 * sites above ever run — `initBox`'s `.gitignore`/`.gitattributes` regen
 * (step 5, called before `mergeIgnoreRules`'s own guard) and
 * `appendManifestEntry`'s (`core/migration-run.ts`) bare `fs.appendFile` into
 * whatever `_config/migrations.jsonl` resolves to. `assertNoSymlinkedAncestors`
 * (`one-root-run.ts`) only lstats DIRECTORY ancestors; a symlinked LEAF at any
 * of these exact paths sails through it untouched. Called from preflight,
 * before anything moves — the manifest is checked at BOTH its pre-migration
 * location (`content/config/migrations.jsonl`) and its post-move v3 path
 * (`packageRoot/_config/migrations.jsonl`), since the file itself relocates
 * mid-migration and `appendManifestEntry` only ever touches the latter.
 */
export async function assertNoSymlinkedCalleeWriteTargets(params: {
  packageRoot: string;
  contentRoot: string;
}): Promise<void> {
  await assertWriteTargetNotSymlink(path.join(params.packageRoot, ".gitignore"));
  await assertWriteTargetNotSymlink(path.join(params.packageRoot, ".gitattributes"));
  await assertWriteTargetNotSymlink(path.join(params.packageRoot, "CLAUDE.md"));
  await assertWriteTargetNotSymlink(path.join(params.contentRoot, V2_MANIFEST_REL));
  await assertWriteTargetNotSymlink(path.join(params.packageRoot, MANIFEST_PATH));
}
