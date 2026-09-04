/**
 * Box-root discovery for the host audit — reading `hub.json` and
 * `boxes.json`, resolving each entry to its actual box root. Split out of
 * `host-audit.ts` to keep that file under the repo's line-count lint budget;
 * both files share the same "dependency-free of beebox source" constraint
 * (see `host-audit.ts`'s header) since this also runs unmodified over ssh.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { HostFinding } from "./host-audit.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (_e) {
    return false;
  }
}

export interface BoxRoot {
  /** The hub slug, or a synthetic label for a `boxes.json`-only entry. */
  slug: string;
  /** The resolved, absolute box root (a `content` dir for a v2 package). */
  root: string;
}

/** A v2 package root's box lives at `<path>/content`; a v1 (or already-a-box)
 *  root has `.beebox/box.json` directly under it. Mirrors
 *  `beebox/src/core/box/package.ts`'s `.beebox/box.json` convention. */
async function resolveBoxRoot(rawPath: string): Promise<string> {
  const directBoxJson = path.join(rawPath, ".beebox", "box.json");
  if (await exists(directBoxJson)) return rawPath;
  return path.join(rawPath, "content");
}

/** `true` only for "the file is not there" — every other read/parse/shape
 *  failure is a manifest that IS there but broken, which must surface as a
 *  finding rather than silently reading as "no boxes". */
function isEnoent(e: unknown): boolean {
  return isRecord(e) && e["code"] === "ENOENT";
}

export interface ManifestLoadResult {
  boxes: BoxRoot[];
  /** Non-empty exactly when the manifest exists but is unreadable or
   *  malformed — a present-but-broken manifest must not silently read as
   *  "no boxes", which would vacate the keying/nesting checks with no sign
   *  anything went wrong. */
  findings: HostFinding[];
  /** Whether the manifest FILE exists at all (regardless of whether it
   *  parsed). Both manifests absent is itself worth a finding — see
   *  {@link loadBoxRoots}. */
  existed: boolean;
}

/** Absent (ENOENT) / broken (any other read failure) / present, for one
 *  manifest file. Shared by both loaders below so the ENOENT-vs-broken
 *  distinction — the whole point of this fix — is written once. */
type ManifestRead = { kind: "absent" } | { kind: "error"; reason: string } | { kind: "ok"; raw: string };

async function readManifestFile(filePath: string): Promise<ManifestRead> {
  try {
    return { kind: "ok", raw: await fs.readFile(filePath, "utf8") };
  } catch (e) {
    return isEnoent(e) ? { kind: "absent" } : { kind: "error", reason: errorMessage(e) };
  }
}

function malformedManifest(filePath: string, reason: string): ManifestLoadResult {
  return { boxes: [], findings: [{ path: filePath, message: `unreadable or malformed box manifest: ${reason}` }], existed: true };
}

/** Read `hub.json`'s `boxes: { slug: { path } }` (mirrors
 *  `beebox/src/hub/hub-config.ts`), tolerating relative `path` values by
 *  resolving them against the config file's own directory the way the real
 *  loader does. A MISSING file reads as no boxes (most machines never run
 *  `bbx hub`); a PRESENT file that fails to read, parse, or match the
 *  expected shape is a finding, not a silent empty result. */
async function loadHubBoxes(homeDir: string): Promise<ManifestLoadResult> {
  const hubJsonPath = path.join(homeDir, ".config", "beebox", "hub.json");
  const read = await readManifestFile(hubJsonPath);
  if (read.kind === "absent") return { boxes: [], findings: [], existed: false };
  if (read.kind === "error") return malformedManifest(hubJsonPath, read.reason);
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.raw);
  } catch (e) {
    return malformedManifest(hubJsonPath, errorMessage(e));
  }
  if (!isRecord(parsed)) return malformedManifest(hubJsonPath, "not a JSON object");
  const boxes = parsed["boxes"];
  if (!isRecord(boxes)) return malformedManifest(hubJsonPath, '"boxes" is missing or not an object');
  const result: BoxRoot[] = [];
  for (const [slug, entry] of Object.entries(boxes)) {
    if (!isRecord(entry)) continue;
    const rawEntryPath = entry["path"];
    if (typeof rawEntryPath !== "string" || rawEntryPath === "") continue;
    const absRawPath = path.isAbsolute(rawEntryPath)
      ? rawEntryPath
      : path.resolve(path.dirname(hubJsonPath), rawEntryPath);
    result.push({ slug, root: await resolveBoxRoot(absRawPath) });
  }
  return { boxes: result, findings: [], existed: true };
}

/** Read `boxes.json`'s `{ boxes: string[] }` (mirrors
 *  `beebox/src/core/box/boxes-config.ts`). Entries have no slug of their own,
 *  so findings name them by their resolved root. Same missing-vs-broken
 *  distinction as {@link loadHubBoxes}. */
async function loadBoxesJsonBoxes(homeDir: string): Promise<ManifestLoadResult> {
  const boxesJsonPath = path.join(homeDir, ".config", "beebox", "boxes.json");
  const read = await readManifestFile(boxesJsonPath);
  if (read.kind === "absent") return { boxes: [], findings: [], existed: false };
  if (read.kind === "error") return malformedManifest(boxesJsonPath, read.reason);
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.raw);
  } catch (e) {
    return malformedManifest(boxesJsonPath, errorMessage(e));
  }
  if (!isRecord(parsed)) return malformedManifest(boxesJsonPath, "not a JSON object");
  const boxes = parsed["boxes"];
  if (!Array.isArray(boxes)) return malformedManifest(boxesJsonPath, '"boxes" is missing or not an array');
  const result: BoxRoot[] = [];
  for (const rawEntryPath of boxes) {
    if (typeof rawEntryPath !== "string" || rawEntryPath === "") continue;
    const root = await resolveBoxRoot(rawEntryPath);
    result.push({ slug: path.basename(rawEntryPath), root });
  }
  return { boxes: result, findings: [], existed: true };
}

export interface BoxRootsResult {
  boxes: BoxRoot[];
  findings: HostFinding[];
}

/** The union of both manifests' box roots, deduped by resolved root, plus any
 *  manifest-level findings (a broken manifest, or both manifests absent). */
export async function loadBoxRoots(homeDir: string): Promise<BoxRootsResult> {
  const hub = await loadHubBoxes(homeDir);
  const boxesJson = await loadBoxesJsonBoxes(homeDir);
  const seen = new Set<string>();
  const boxes: BoxRoot[] = [];
  for (const box of [...hub.boxes, ...boxesJson.boxes]) {
    if (seen.has(box.root)) continue;
    seen.add(box.root);
    boxes.push(box);
  }
  const findings = [...hub.findings, ...boxesJson.findings];
  if (!hub.existed && !boxesJson.existed) {
    findings.push({
      path: path.join(homeDir, ".config", "beebox"),
      message: "no box manifest found; keying and nesting checks vacated",
    });
  }
  return { boxes, findings };
}
