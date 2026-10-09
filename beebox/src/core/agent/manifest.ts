/**
 * Session manifest — append-only log of agent sessions started in a box.
 *
 * Each agent's first invoke records its SDK-assigned session id alongside
 * the task name, so usage tooling can correlate sessions back to work.
 */

import * as path from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import { BOX_DIRS } from "../../lib/paths/core.js";
import { stageAndCommitPaths } from "../../lib/git/core/operations.js";

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

/**
 * Commit the manifest alone. An agent run that commits its own work sweeps the
 * manifest line in with it; a run that writes nothing else (the after-turn
 * chat title) calls this, or the tracked file stays dirty until some unrelated
 * commit sweeps it under that commit's name. A no-op when the manifest is
 * unchanged.
 */
export async function commitSessionManifest(boxRoot: string, { task }: { task: string }): Promise<void> {
  await stageAndCommitPaths(boxRoot, {
    paths: [MANIFEST_REL_PATH],
    message: `Usage: record ${task} session`,
    trailers: { "Commit-Source": task },
  });
}
