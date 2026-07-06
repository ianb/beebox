/**
 * Session layout + input classification for the scan-import command.
 *
 * Every scan-import run (photo or document) allocates one capture-session
 * card under `box/inbox/scan-<date>-<id>.capture-session.card` with a sibling
 * `.attach/` scope. `createSessionLayout` computes those paths and creates the
 * attach directory. The file-type predicates and the optional CLAUDE_SCANS.md
 * context reader round out the shared, side-feature-free primitives.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { CommandContext } from "../command-runner.js";
import { getBoxTimeISO } from "../../lib/time.js";
import {
  PDF_EXTENSION,
  SUPPORTED_IMAGE_EXTENSIONS,
} from "./upload-helpers.js";

export interface SessionLayout {
  sessionId: string;
  /** Basename of the session card (e.g. `scan-20260310T1924-abc12345`). */
  sessionBasename: string;
  /** Inbox-relative dir holding the session card. */
  inboxRelDir: string;
  /** Absolute path to the directory that holds the session card. */
  inboxAbsDir: string;
  /** Filename of the session card itself. */
  sessionCardFilename: string;
  /** Absolute path to the session card. */
  sessionCardAbsPath: string;
  /** Inbox-relative path to the session card. */
  sessionCardRelPath: string;
  /** Inbox-relative dir of the session's attach scope. */
  sessionAttachRelDir: string;
  /** Absolute path to the session's attach scope. */
  sessionAttachAbsDir: string;
  startedAt: string;
}

export const isImageFile = (p: string): boolean =>
  SUPPORTED_IMAGE_EXTENSIONS.includes(path.extname(p).toLowerCase());
export const isPdfFile = (p: string): boolean =>
  path.extname(p).toLowerCase() === PDF_EXTENSION;

export async function readScanContextFile(boxRoot: string): Promise<string | null> {
  for (const name of ["CLAUDE_SCANS.md", "claude_scans.md"]) {
    try {
      const content = await fs.readFile(path.join(boxRoot, name), "utf-8");
      if (content.trim().length > 0) return content;
    } catch (_e) {
      // Context file is optional — readFile rejects when this candidate
      // name doesn't exist, which is the common case. Try the next name;
      // returning null (no context) at the end is a valid outcome.
    }
  }
  return null;
}

export async function createSessionLayout(ctx: CommandContext): Promise<SessionLayout> {
  const sessionId = randomUUID();
  const shortId = sessionId.slice(0, 8);
  const startedAt = getBoxTimeISO(ctx.boxRoot);
  const stamp = startedAt.replace(/[:-]/g, "").slice(0, 13);
  const formattedDate = `${stamp.slice(0, 8)}T${stamp.slice(9, 13)}`;
  const sessionBasename = `scan-${formattedDate}-${shortId}`;
  const inboxRelDir = "box/inbox";
  const inboxAbsDir = path.join(ctx.boxRoot, inboxRelDir);
  const sessionCardFilename = `${sessionBasename}.capture-session.card`;
  const sessionAttachRelDir = `${inboxRelDir}/${sessionBasename}.attach`;
  const sessionAttachAbsDir = path.join(ctx.boxRoot, sessionAttachRelDir);
  await fs.mkdir(sessionAttachAbsDir, { recursive: true });
  return {
    sessionId,
    sessionBasename,
    inboxRelDir,
    inboxAbsDir,
    sessionCardFilename,
    sessionCardAbsPath: path.join(inboxAbsDir, sessionCardFilename),
    sessionCardRelPath: `${inboxRelDir}/${sessionCardFilename}`,
    sessionAttachRelDir,
    sessionAttachAbsDir,
    startedAt,
  };
}
