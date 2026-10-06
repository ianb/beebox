/** Box-agent inspection and resolution of parked template updates. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ScheduledScriptSchema } from "../schemas/scheduled-script/schema.js";
import { parseCard } from "./template-merge.js";
import {
  parkedUpdatePath, readVersions, writeVersions, removeParkedMirror,
  sha256, stripBoxOwnedFields, TEMPLATE_UPDATES_DIR,
} from "./install-template-file.js";

export class InvalidTemplatePathError extends Error {
  constructor() {
    super("Expected a box-relative template path");
    this.name = "InvalidTemplatePathError";
  }
}

export class ParkedTemplateChangedError extends Error {
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

export async function readTemplateUpdate(boxRoot: string, relPath: string): Promise<{ local: string; parked: string; stock: string | null; stockHash: string | null }> {
  validateTemplatePath(relPath);
  const [local, parked, versions] = await Promise.all([
    fs.readFile(path.join(boxRoot, relPath), "utf-8"),
    fs.readFile(path.join(boxRoot, parkedUpdatePath(relPath)), "utf-8"),
    readVersions(boxRoot),
  ]);
  return { local, parked, stock: versions[relPath]?.stock ?? null, stockHash: versions[relPath]?.sha256 ?? null };
}

/** Record an agent's completed resolution of the currently parked version. */
export async function resolveTemplateUpdate({ boxRoot, relPath, accept }: { boxRoot: string; relPath: string; accept: boolean }): Promise<void> {
  validateTemplatePath(relPath);
  const local = path.join(boxRoot, relPath);
  const parked = path.join(boxRoot, parkedUpdatePath(relPath));
  const upstream = await fs.readFile(parked, "utf-8");
  if (relPath.endsWith(".card")) parseCard(upstream);
  await fs.access(local);
  const versions = await readVersions(boxRoot);
  const fields = ownedFieldsForPath(relPath);
  const parkedHash = sha256(stripBoxOwnedFields(upstream, fields));
  const pending = versions[relPath]?.pending;
  if (pending !== undefined && pending !== parkedHash) throw new ParkedTemplateChangedError();
  const hash = pending ?? parkedHash;
  if (accept) await fs.writeFile(local, upstream);
  versions[relPath] = { sha256: hash, "installed-at": new Date().toISOString(), stock: upstream };
  await writeVersions(boxRoot, versions);
  await removeParkedMirror(boxRoot, relPath);
}

/** Keep the tracker in step when a migration rewrites an unmodified stock file. */
export async function recordAutomatedTemplateRewrite({ boxRoot, relPath, before, after }: { boxRoot: string; relPath: string; before: string; after: string }): Promise<void> {
  validateTemplatePath(relPath);
  const versions = await readVersions(boxRoot);
  const previous = versions[relPath];
  if (previous?.sha256 === undefined) return;
  const fields = ownedFieldsForPath(relPath);
  if (sha256(stripBoxOwnedFields(before, fields)) !== previous.sha256) return;
  versions[relPath] = {
    sha256: sha256(stripBoxOwnedFields(after, fields)),
    "installed-at": new Date().toISOString(),
    stock: after,
  };
  await writeVersions(boxRoot, versions);
}
