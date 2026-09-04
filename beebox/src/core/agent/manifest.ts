/**
 * Session manifest — append-only log of agent sessions started in a box.
 *
 * Each agent's first invoke records its SDK-assigned session id alongside
 * the task name, so usage tooling can correlate sessions back to work.
 */

import * as path from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import { BOX_DIRS } from "../../lib/paths.js";

const MANIFEST_REL_PATH = `${BOX_DIRS.usage}/session-manifest.jsonl`;

interface ManifestEntry {
  sessionId: string;
  task: string;
  timestamp: string;
}

export function appendSessionManifest(boxRoot: string, entry: ManifestEntry): void {
  const manifestPath = path.join(boxRoot, MANIFEST_REL_PATH);
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  appendFileSync(manifestPath, JSON.stringify(entry) + "\n");
}
