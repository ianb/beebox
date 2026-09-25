/** Per-session notices for persistent PostToolUse validation warnings. */

import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { errnoCode } from "../../lib/error-guards.js";
import { requestScopedLock, withFileLock } from "../../lib/file-lock.js";
import { isRecord } from "../../lib/is-record.js";

interface Notice {
  sessionId: string;
  file: string;
  category: string;
  fingerprint: string;
  updatedAt: number;
}

const MAX_NOTICES = 256;
const NOTICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function statePath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "validate-hook-warnings.json");
}

function isNotice(value: unknown): value is Notice {
  return isRecord(value) &&
    typeof value["sessionId"] === "string" &&
    typeof value["file"] === "string" &&
    typeof value["category"] === "string" &&
    typeof value["fingerprint"] === "string" &&
    typeof value["updatedAt"] === "number" &&
    Number.isFinite(value["updatedAt"]);
}

async function readNotices(filePath: string): Promise<Notice[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    return [];
  }
  if (!isRecord(parsed) || parsed["version"] !== 1 || !Array.isArray(parsed["notices"])) return [];
  const notices: unknown[] = parsed["notices"];
  if (!notices.every(isNotice)) return [];
  return notices;
}

/**
 * Record a warning for one edited file. Return false when the same warning was
 * already delivered in this session. A null fingerprint clears the notice after
 * a clean edit. Callers must fail open (deliver the warning) on cache errors.
 */
export async function recordHookWarning(options: {
  boxRoot: string;
  sessionId: string;
  filePath: string;
  category: string;
  fingerprint: string | null;
}): Promise<boolean> {
  const { boxRoot, sessionId, filePath, category, fingerprint } = options;
  const file = path.relative(boxRoot, filePath).split(path.sep).join("/");
  const cachePath = statePath(boxRoot);
  return withFileLock(
    {
      lockPath: requestScopedLock(`${cachePath}.lock`),
      metadata: { purpose: "validate-hook-warning-cache" },
      waitMs: 500,
    },
    async () => {
      const now = Date.now();
      const notices = (await readNotices(cachePath)).filter((notice) =>
        notice.updatedAt <= now && now - notice.updatedAt < NOTICE_TTL_MS,
      );
      const matchesFile = (notice: Notice): boolean =>
        notice.sessionId === sessionId && notice.file === file && notice.category === category;
      let nextNotices = notices;
      if (fingerprint === null) {
        if (!notices.some(matchesFile)) return false;
        nextNotices = notices.filter((notice) => !matchesFile(notice));
      } else {
        if (notices.some((notice) => matchesFile(notice) && notice.fingerprint === fingerprint)) return false;
        nextNotices = [...notices, { sessionId, file, category, fingerprint, updatedAt: now }];
      }
      nextNotices.sort((a, b) => b.updatedAt - a.updatedAt);
      await writeFileAtomic(cachePath, {
        content: `${JSON.stringify({ version: 1, notices: nextNotices.slice(0, MAX_NOTICES) })}\n`,
        mode: 0o600,
      });
      return fingerprint !== null;
    },
  );
}
