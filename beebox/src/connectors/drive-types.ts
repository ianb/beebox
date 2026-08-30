/**
 * Google Drive type handler registry.
 *
 * Each handler covers a set of Google mimeTypes and knows how to:
 * - Inspect a file (preview metadata)
 * - Pull content from Drive to local files
 * - Push local changes back to Drive
 *
 * Register handlers with registerDriveHandler(). The connector resolves
 * a file's mimeType and delegates to the matching handler.
 */

import type { GoogleDriveService, DriveFile } from "../services/google-drive.js";
import { invariant } from "../lib/invariant.js";

// ─── Handler interface ──────────────────────────────────────────────────────

export interface InspectResult {
  title: string;
  mimeType: string;
  owner: string;
  modifiedTime: string;
  /** Type-specific details (e.g., sheet tab names, word count) */
  details: Record<string, unknown>;
}

export interface PullResult {
  /** Files written (relative to box root) */
  written: string[];
  /** Whether anything actually changed */
  changed: boolean;
}

export interface PushResult {
  /** Files pushed back to Drive */
  pushed: string[];
}

export interface FileState {
  /** Content hashes per local file, keyed by relative path */
  contentHashes: Record<string, string>;
  /** Last known remote modifiedTime */
  lastModified: string;
  /** Type-specific state */
  extra: Record<string, unknown>;
}

export interface DriveTypeHandler {
  /** Google mimeTypes this handler covers */
  mimeTypes: string[];

  /** Card type it produces (e.g., "drive-sheet") */
  cardType: string;

  /** Preview metadata without syncing */
  inspect(file: DriveFile, service: GoogleDriveService): Promise<InspectResult>;

  /** Pull content from Drive to local files */
  pull(opts: {
    file: DriveFile;
    localDir: string;
    cardPath: string;
    boxRoot: string;
    service: GoogleDriveService;
    state: FileState;
  }): Promise<PullResult>;

  /** Push local changes back to Drive */
  push(opts: {
    file: DriveFile;
    localDir: string;
    cardPath: string;
    boxRoot: string;
    service: GoogleDriveService;
    state: FileState;
  }): Promise<PushResult>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const handlers: DriveTypeHandler[] = [];

export function registerDriveHandler(handler: DriveTypeHandler): void {
  handlers.push(handler);
}

export function getHandlerForMimeType(mimeType: string): DriveTypeHandler | undefined {
  return handlers.find((h) => h.mimeTypes.includes(mimeType));
}

export function getAllDriveHandlers(): DriveTypeHandler[] {
  return [...handlers];
}

// ─── URL parsing ────────────────────────────────────────────────────────────

/**
 * Extract a Google Drive file ID from a URL or bare ID.
 *
 * Supported URL formats:
 * - https://docs.google.com/spreadsheets/d/FILE_ID/edit
 * - https://docs.google.com/document/d/FILE_ID/edit
 * - https://docs.google.com/presentation/d/FILE_ID/edit
 * - https://drive.google.com/file/d/FILE_ID/view
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/drive/folders/FOLDER_ID (also /drive/u/0/folders/…)
 * - Bare file ID (alphanumeric + hyphens + underscores)
 */
export function extractDriveFileId(input: string): string | null {
  // Folder URL. Checked first because it shares no pattern with the others —
  // a folder URL has no `/d/` segment, so before this it only resolved by
  // accident when someone pasted a bare ID.
  const folderPattern = /\/folders\/([\w-]+)/;
  const folderMatch = input.match(folderPattern);
  if (folderMatch) {
    invariant(folderMatch[1] !== undefined, "capture group 1 is non-optional in folderPattern");
    return folderMatch[1];
  }

  // URL with /d/FILE_ID/ pattern
  const dPattern = /\/d\/([\w-]+)/;
  const dMatch = input.match(dPattern);
  if (dMatch) {
    invariant(dMatch[1] !== undefined, "capture group 1 is non-optional in dPattern");
    return dMatch[1];
  }

  // URL with ?id=FILE_ID parameter
  const idParam = /[&?]id=([\w-]+)/;
  const idMatch = input.match(idParam);
  if (idMatch) {
    invariant(idMatch[1] !== undefined, "capture group 1 is non-optional in idParam");
    return idMatch[1];
  }

  // Bare file ID (must look like one — at least 10 chars, only valid chars)
  if (/^[\w-]{10,}$/.test(input)) {
    return input;
  }

  return null;
}
