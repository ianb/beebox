/**
 * The distro packages a box needs from its host — `_config/host-packages.json`.
 *
 * The box records each package with the reason it needed it, so the need
 * survives a rebuilt server or a recreated container and the boxholder can see
 * why the package is there. Installing is the root wrapper's job
 * (`deploy/server-bin/bbx-host-apt`, driven by `bbx host`); this module is the
 * record and the pure decisions around it.
 *
 * Same config idiom as `core/tts/config.ts`: a small JSON file, `withCardLock`
 * around read-merge-write, absent means empty, malformed is a loud error.
 * The name check here only gives the agent a better error — the wrapper
 * enforces its own copy of the pattern and much more.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { withCardLock } from "../lib/card-lock.js";
import { errnoCode, errorMessage } from "../lib/error-guards.js";

export const HOST_PACKAGES_PATH = "_config/host-packages.json";

/** Debian package-name alphabet, capped as the wrapper caps it. */
const PACKAGE_NAME = /^[\da-z][\d+.a-z-]{1,63}$/;

const entrySchema = z.object({
  why: z.string().trim().min(1),
  added: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const manifestSchema = z.object({
  packages: z.record(z.string().regex(PACKAGE_NAME), entrySchema),
}).strict();

export type HostPackages = z.infer<typeof manifestSchema>["packages"];

/** The manifest exists but is not valid; `detail` says where. */
export class HostPackagesParseError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super("_config/host-packages.json is not valid");
    this.name = "HostPackagesParseError";
    this.detail = detail;
  }
}

/** Names that are not valid Debian package names, in input order. */
export function invalidPackageNames(names: readonly string[]): string[] {
  return names.filter((name) => !PACKAGE_NAME.test(name));
}

/** Recorded packages absent from `installed`, sorted. */
export function missingHostPackages(packages: HostPackages, installed: ReadonlySet<string>): string[] {
  return Object.keys(packages).filter((name) => !installed.has(name)).toSorted();
}

function parseManifest(content: string): HostPackages {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    throw new HostPackagesParseError(errorMessage(e));
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? "invalid" : [issue.path.join("."), issue.message].join(": ");
    throw new HostPackagesParseError(where);
  }
  return parsed.data.packages;
}

async function readManifest(manifestPath: string): Promise<HostPackages> {
  let content: string;
  try {
    content = await fs.readFile(manifestPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return {};
    throw e;
  }
  return parseManifest(content);
}

/** The box's recorded packages; `{}` when the file is absent. */
export async function loadHostPackages(boxRoot: string): Promise<HostPackages> {
  return readManifest(path.join(boxRoot, HOST_PACKAGES_PATH));
}

interface RecordRequest {
  names: readonly string[];
  why: string;
  /** `YYYY-MM-DD`. */
  added: string;
}

/**
 * Add `names` to the manifest. An already-recorded name keeps its original
 * reason and date. Returns the names that were newly recorded. A malformed
 * manifest throws rather than being overwritten.
 */
export async function recordHostPackages(boxRoot: string, { names, why, added }: RecordRequest): Promise<string[]> {
  const manifestPath = path.join(boxRoot, HOST_PACKAGES_PATH);
  return withCardLock(manifestPath, async () => {
    const packages = await readManifest(manifestPath);
    const recorded: string[] = [];
    for (const name of names) {
      if (packages[name] !== undefined) continue;
      packages[name] = { why: why.trim(), added };
      recorded.push(name);
    }
    if (recorded.length === 0) return recorded;
    const sorted = Object.fromEntries(Object.entries(packages).toSorted(([a], [b]) => a.localeCompare(b)));
    // Validate what we write with the same schema that reads it.
    const content = JSON.stringify({ packages: sorted }, null, 2) + "\n";
    parseManifest(content);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, content);
    return recorded;
  });
}
