/** Box-agent inspection and resolution of parked template updates. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ScheduledScriptSchema } from "../schemas/scheduled-script/schema.js";
import { parseCard } from "./template-merge.js";
import {
  parkedUpdatePath, readVersions, writeVersions, removeParkedMirror,
  sha256, stripBoxOwnedFields, TEMPLATE_UPDATES_DIR,
} from "./install-template-file.js";
import { existingSiblingPath, ledgerKey } from "./template-sibling-key.js";

class InvalidTemplatePathError extends Error {
  constructor() {
    super("Expected a box-relative template path");
    this.name = "InvalidTemplatePathError";
  }
}

class ParkedTemplateChangedError extends Error {
  constructor() {
    super("Parked template changed since it was written; run the installer again before resolving");
    this.name = "ParkedTemplateChangedError";
  }
}

function validateTemplatePath(relPath: string): void {
  if (
    !relPath || relPath === "." || path.isAbsolute(relPath) || relPath.includes("\\")
    || relPath.split("/").includes("..") || path.posix.normalize(relPath) !== relPath
    || relPath.startsWith(`${TEMPLATE_UPDATES_DIR}/`)
  ) {
    throw new InvalidTemplatePathError();
  }
}

function ownedFieldsForPath(relPath: string): readonly string[] {
  return relPath.endsWith(".scheduled-script.card")
    ? (ScheduledScriptSchema.templateMerge?.boxOwnedFields ?? [])
    : [];
}

/**
 * The on-disk file and parked copy for `relPath`. An instruction file may sit
 * under either name while a box converts; each is found under whichever name
 * exists (the sibling-key rule in `install-template-file.ts`).
 */
async function templatePaths(boxRoot: string, relPath: string): Promise<{ local: string; parked: string }> {
  const localRel = await existingSiblingPath(boxRoot, relPath);
  const parkedRel = await existingSiblingPath(path.join(boxRoot, TEMPLATE_UPDATES_DIR), relPath);
  return { local: path.join(boxRoot, localRel), parked: path.join(boxRoot, parkedUpdatePath(parkedRel)) };
}

export async function readTemplateUpdate(boxRoot: string, relPath: string): Promise<{ local: string; parked: string; stock: string | null; stockHash: string | null }> {
  validateTemplatePath(relPath);
  const paths = await templatePaths(boxRoot, relPath);
  const [local, parked, versions] = await Promise.all([
    fs.readFile(paths.local, "utf-8"),
    fs.readFile(paths.parked, "utf-8"),
    readVersions(boxRoot),
  ]);
  const key = ledgerKey(versions, relPath);
  return { local, parked, stock: versions[key]?.stock ?? null, stockHash: versions[key]?.sha256 ?? null };
}

/** Record an agent's completed resolution of the currently parked version. */
export async function resolveTemplateUpdate({ boxRoot, relPath, accept }: { boxRoot: string; relPath: string; accept: boolean }): Promise<void> {
  validateTemplatePath(relPath);
  const { local, parked } = await templatePaths(boxRoot, relPath);
  const upstream = await fs.readFile(parked, "utf-8");
  if (relPath.endsWith(".card")) parseCard(upstream);
  await fs.access(local);
  const versions = await readVersions(boxRoot);
  const key = ledgerKey(versions, relPath);
  const fields = ownedFieldsForPath(relPath);
  const parkedHash = sha256(stripBoxOwnedFields(upstream, fields));
  const pending = versions[key]?.pending;
  if (pending !== undefined && pending !== parkedHash) throw new ParkedTemplateChangedError();
  const hash = pending ?? parkedHash;
  if (accept) await fs.writeFile(local, upstream);
  versions[key] = { sha256: hash, "installed-at": new Date().toISOString(), stock: upstream };
  await writeVersions(boxRoot, versions);
  await removeParkedMirror(boxRoot, relPath);
}

/** Keep the tracker in step when a migration rewrites an unmodified stock file. */
export async function recordAutomatedTemplateRewrite({ boxRoot, relPath, before, after }: { boxRoot: string; relPath: string; before: string; after: string }): Promise<void> {
  validateTemplatePath(relPath);
  const versions = await readVersions(boxRoot);
  const key = ledgerKey(versions, relPath);
  const previous = versions[key];
  if (previous?.sha256 === undefined) return;
  const fields = ownedFieldsForPath(relPath);
  if (sha256(stripBoxOwnedFields(before, fields)) !== previous.sha256) return;
  versions[key] = {
    sha256: sha256(stripBoxOwnedFields(after, fields)),
    "installed-at": new Date().toISOString(),
    stock: after,
  };
  await writeVersions(boxRoot, versions);
}
