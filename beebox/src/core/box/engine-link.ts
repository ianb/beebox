/**
 * The engine link: `<box>/.beebox/engine`, a gitignored symlink to the engine
 * package this machine runs the box with. The box's tracked `package.json`
 * declares `"beebox": "link:.beebox/engine"` (`ENGINE_LINK_SPEC`), the same
 * value on every machine, so no install path writes a machine path into box
 * history. Each install path makes the link before `pnpm install`; the shell
 * paths use `bin/box-engine-link`, which applies the same usability rule.
 * Plan: `docs/implemented-plans/portable-engine-dependency.md`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../shared/error-guards.js";
import { isRecord } from "../../shared/is-record.js";
import { isWithin } from "../../lib/box-containment.js";

/** The link's path relative to the box root. */
export const ENGINE_LINK = ".beebox/engine";

/** The portable `beebox` dependency spec every box commits. */
export const ENGINE_LINK_SPEC = `link:${ENGINE_LINK}`;

/** The engine link could not be made usable; the message carries the repair. */
export class EngineLinkError extends Error {
  readonly boxRoot: string;
  constructor(boxRoot: string, reason: string) {
    super(`${reason} Repair: ln -sfn <engine checkout>/beebox ${path.join(boxRoot, ENGINE_LINK)}`);
    this.name = "EngineLinkError";
    this.boxRoot = boxRoot;
  }
}

/** The real path of `dir` when it is an engine package (its `package.json` is named `beebox`), else null. */
export async function engineRealPath(dir: string): Promise<string | null> {
  let real: string;
  let text: string;
  try {
    real = await fs.realpath(dir);
    text = await fs.readFile(path.join(real, "package.json"), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") return null;
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    // An unparseable package.json is not an engine package; the caller names the path.
    return null;
  }
  return isRecord(parsed) && parsed["name"] === "beebox" ? real : null;
}

/**
 * Make `<boxRoot>/.beebox/engine` a usable link. A link that already resolves
 * to an engine is kept, whatever it points at: the main checkout's `bbx` run on
 * a worktree clone must not repoint it. A missing or dead link is pointed at
 * `target`, which must be an engine outside the box.
 * @returns whether the link was (re)written.
 * @throws EngineLinkError when `target` is not an engine, lies inside the box,
 *   or `.beebox/engine` is something other than a symlink.
 */
export async function ensureEngineLink(boxRoot: string, target: string): Promise<{ written: boolean }> {
  const linkPath = path.join(boxRoot, ENGINE_LINK);
  if ((await engineRealPath(linkPath)) !== null) return { written: false };
  const resolvedTarget = path.resolve(boxRoot, target);
  const engine = await engineRealPath(resolvedTarget);
  if (engine === null) throw new EngineLinkError(boxRoot, `${resolvedTarget} is not a beebox engine package.`);
  if (isWithin(await fs.realpath(boxRoot), engine)) {
    throw new EngineLinkError(boxRoot, `${resolvedTarget} is inside the box; the next install could remove it.`);
  }
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  const existing = await fs.lstat(linkPath).catch((e: unknown) => {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  });
  if (existing !== null && !existing.isSymbolicLink()) {
    throw new EngineLinkError(boxRoot, `${linkPath} exists and is not a symlink.`);
  }
  if (existing !== null) await fs.unlink(linkPath);
  await fs.symlink(resolvedTarget, linkPath, "dir");
  return { written: true };
}

/** The box's declared `beebox` spec (`dependencies`, then `devDependencies`), or undefined. */
export async function readBeeBoxSpec(boxRoot: string): Promise<string | undefined> {
  const parsed: unknown = JSON.parse(await fs.readFile(path.join(boxRoot, "package.json"), "utf-8"));
  if (!isRecord(parsed)) return undefined;
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = parsed[field];
    const spec = isRecord(deps) ? deps["beebox"] : undefined;
    if (typeof spec === "string") return spec;
  }
  return undefined;
}

/** `ensureEngineLink` for a box that declares the portable spec; a box with a pinned engine needs no link. */
export async function ensurePortableEngineLink(boxRoot: string, target: string): Promise<{ written: boolean }> {
  if ((await readBeeBoxSpec(boxRoot)) !== ENGINE_LINK_SPEC) return { written: false };
  return ensureEngineLink(boxRoot, target);
}
