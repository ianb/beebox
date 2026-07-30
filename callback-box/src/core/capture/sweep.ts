/**
 * Abandonment sweep for staged captures (Track 5).
 *
 * A capture whose browser crashed or disconnected leaves its media staged in
 * the box but never finalized. This sweep, run periodically by the webapp box
 * scope (and belt-and-braces from `cb wakeup`), turns those orphans into
 * delivered — but explicitly *partial* — captures rather than losing them
 * silently (engineering principle #4: resilient AND never silent):
 *
 * - `sealed`/`preparing`/`delivering` (any age) → preparation re-fired when the
 *   sweep has a runtime (`firePreparation`). `cb wakeup`'s seal-only sweep and a
 *   crashed worker both leave sessions in these states with nothing to advance
 *   them until the next server startup's resume scan; the periodic server sweep
 *   folds in `resume.ts`'s re-fire so they don't strand between restarts. The
 *   in-flight set + idempotent steps + CAS make the double-fire safe.
 * - `open` with no activity for {@link ABANDONMENT_WINDOW_MS}:
 *   - empty (no media) → discarded, matching the finalize empty-short-circuit;
 *   - otherwise → CAS-sealed with `partial: true` and preparation fired (the
 *     same path a normal Done uses, so the capture card gets `partial: true`
 *     frontmatter and the `<capture partial="1">` wrapper).
 * - `failed:*` older than the window → logged once per run (stale, needs a
 *   human) but NOT auto-retried — a repeatedly-failing capture shouldn't loop.
 * - delivered capture cards left under any `tmp-capture/` for more than
 *   {@link TMP_CAPTURE_STALE_MS} → logged (never deleted; filing them is the
 *   chat agent's duty, per the schema instructions).
 *
 * The seal is a compare-and-swap restricted to `open` (see
 * `sealStagingSession`'s `requireOpen`), so a capture the user finalized
 * between the sweep's listing and its seal is never re-sealed or re-fired.
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { getBoxTime } from "../../lib/time.js";
import { parseCaptureSession } from "../../schemas/capture-session.js";
import {
  listStagingSessions,
  sealStagingSession,
  stagingSessionIsEmpty,
  isCaptureSession,
} from "./staging-store.js";
import { cleanupStagingSession } from "./staging-teardown.js";

/** No-activity window after which an open capture is swept into a partial finalize. */
export const ABANDONMENT_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

/** Age after which a delivered card still under `tmp-capture/` is flagged unfiled. */
export const TMP_CAPTURE_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Directories never worth descending into while hunting for `tmp-capture/`. */
const SKIP_DIRS = new Set([".git", "node_modules", "tmp", ".callback-box"]);

export interface SweepDeps {
  boxRoot: string;
  /**
   * Fire preparation for a freshly sealed session. Provided by the server box
   * scope (which holds the chat runtime); omitted in the `cb wakeup` path,
   * where a sealed-partial session simply waits for the next server startup's
   * resume scan to prepare + deliver it.
   */
  firePreparation?: ((id: string) => void) | undefined;
}

export interface SweepResult {
  /** Ids CAS-sealed as partial (and fired, if `firePreparation` was given). */
  sealed: string[];
  /**
   * Ids already `sealed`/`preparing`/`delivering` whose preparation this pass
   * re-fired (server sweep only — `firePreparation` present). Idempotent.
   */
  refired: string[];
  /** Empty open ids removed. */
  discarded: string[];
  /** `failed:*` ids past the window — warned, never retried. */
  staleFailed: string[];
  /** Box-relative delivered capture cards under `tmp-capture/` past the stale age. */
  staleTmpCaptureCards: string[];
}

/**
 * Sweep one box's staging area once. Idempotent and safe to double-fire: the
 * CAS seal fires preparation at most once, and `prepareCaptureSession` itself
 * guards against a concurrent in-flight run.
 */
export async function sweepAbandonedCaptures(deps: SweepDeps): Promise<SweepResult> {
  const { boxRoot, firePreparation } = deps;
  const now = getBoxTime(boxRoot).getTime();
  const result: SweepResult = { sealed: [], refired: [], discarded: [], staleFailed: [], staleTmpCaptureCards: [] };

  // Capture-only: bulk-upload sessions have their own finalize/abandonment
  // handling and must never be swept into a partial *capture*.
  const sessions = (await listStagingSessions({ boxRoot })).filter(isCaptureSession);
  for (const session of sessions) {
    // Re-fire sessions already sealed/mid-flight, regardless of age (X2): a
    // wakeup seal or a dead worker leaves them with nothing to advance them.
    // Only when this sweep has a runtime to prepare with; otherwise the next
    // server startup's resume scan handles them.
    if (
      firePreparation !== undefined &&
      (session.state === "sealed" || session.state === "preparing" || session.state === "delivering")
    ) {
      result.refired.push(session.id);
      firePreparation(session.id);
      continue;
    }

    const ageMs = now - new Date(session.lastActivityAt).getTime();
    const isStale = ageMs >= ABANDONMENT_WINDOW_MS;
    if (!isStale) continue;

    if (session.state === "open") {
      if (stagingSessionIsEmpty(session)) {
        await cleanupStagingSession({ boxRoot, id: session.id });
        result.discarded.push(session.id);
        continue;
      }
      const seal = await sealStagingSession({ boxRoot, id: session.id, partial: true, requireOpen: true });
      if (seal.sealed) {
        result.sealed.push(session.id);
        firePreparation?.(session.id);
      }
    } else if (session.state.startsWith("failed:")) {
      result.staleFailed.push(session.id);
    }
  }

  if (result.staleFailed.length > 0) {
    console.warn(
      `[capture] Sweep found ${result.staleFailed.length} stale failed capture(s) needing attention (not auto-retried): ${result.staleFailed.join(", ")}`,
    );
  }

  result.staleTmpCaptureCards = await findStaleTmpCaptureCards({ boxRoot, now });
  if (result.staleTmpCaptureCards.length > 0) {
    console.warn(
      `[capture] Sweep found ${result.staleTmpCaptureCards.length} delivered capture(s) unfiled in tmp-capture/ for over 7 days (file or delete them): ${result.staleTmpCaptureCards.join(", ")}`,
    );
  }

  return result;
}

/**
 * Box-relative paths of `delivered` capture-session cards sitting under any
 * `tmp-capture/` directory whose `time.start` is older than the stale age.
 * Reference is the card's own `time.start` (deterministic under `CB_TIME`),
 * not file mtime (which git operations reset).
 */
async function findStaleTmpCaptureCards(opts: { boxRoot: string; now: number }): Promise<string[]> {
  const { boxRoot, now } = opts;
  const stale: string[] = [];
  const captureDirs = await findTmpCaptureDirs(boxRoot, boxRoot);
  for (const dir of captureDirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (_e) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".capture-session.card")) continue;
      const absPath = path.join(dir, entry);
      let content: string;
      try {
        content = await fs.readFile(absPath, "utf-8");
      } catch (_e) {
        continue;
      }
      const parsed = parseCaptureSession(content);
      if (parsed === null || parsed.frontmatter.status !== "delivered") continue;
      const startedAt = parsed.frontmatter.time?.start;
      if (startedAt === undefined) continue;
      if (now - new Date(startedAt).getTime() < TMP_CAPTURE_STALE_MS) continue;
      stale.push(path.relative(boxRoot, absPath));
    }
  }
  return stale.toSorted();
}

/** Recursively collect every `tmp-capture` directory under `root`, skipping
 *  git/node_modules/tmp/.callback-box. */
async function findTmpCaptureDirs(boxRoot: string, root: string): Promise<string[]> {
  const found: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (_e) {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(root, entry.name);
    if (entry.name === "tmp-capture") {
      found.push(abs);
      continue; // capture cards live directly in here, no need to recurse further
    }
    found.push(...(await findTmpCaptureDirs(boxRoot, abs)));
  }
  return found;
}
