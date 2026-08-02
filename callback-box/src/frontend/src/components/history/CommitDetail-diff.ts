/**
 * CommitDetail diff parsing — pure helpers for turning a unified git diff
 * into structured DiffFile records, plus new-file content extraction.
 */

// Raw relative (not `@shared/…`): loaded outside Vite by the tap/tsx doctest
// runner (root tsconfig, no @shared resolution) — see OUTSIDE_VITE_SHARED_RAW.
import { invariant } from "../../../../shared/invariant.js";

export interface DiffFile {
  path: string;
  meta: string[];
  hunks: string[];
  binary: boolean;
  move?: { basename: string; fromDir: string; toDir: string };
}

function extractFilePath(line: string): string {
  const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  return match?.[2] ?? line;
}

interface FinalizeRenameParams {
  file: DiffFile;
  from: string;
  to: string;
}

function finalizeRename(params: FinalizeRenameParams): void {
  const { file, from, to } = params;
  file.path = to;
  const fromName = from.split("/").pop();
  const toName = to.split("/").pop();
  invariant(fromName !== undefined && toName !== undefined, "split('/') never returns an empty array");
  if (fromName === toName) {
    const fromDir = from.substring(0, from.length - fromName.length) || "/";
    const toDir = to.substring(0, to.length - toName.length) || "/";
    file.move = { basename: toName, fromDir, toDir };
    file.meta.push("moved");
  } else {
    file.meta.push(`renamed from ${from}`);
  }
}

/**
 * Detect Git LFS or git-annex pointer content in diff hunks. Both store a
 * small text stand-in for the real bytes: LFS files start with
 * "version https://git-lfs.github.com/spec/v1", annexed files with
 * "/annex/objects/" (full grammar in src/lib/annex-pointer.ts — the prefix
 * alone is decisive here). Removed files carry their pointer on "-" lines,
 * so both added and removed lines are inspected.
 */
function isPointerDiff(hunks: string[]): boolean {
  return hunks
    .filter((l) => l.startsWith("+") || l.startsWith("-"))
    .map((l) => l.slice(1))
    .some(
      (l) =>
        l.startsWith("version https://git-lfs.github.com/spec/v1") ||
        l.startsWith("/annex/objects/")
    );
}

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current && renameFrom && renameTo) {
        finalizeRename({ file: current, from: renameFrom, to: renameTo });
      }
      renameFrom = null;
      renameTo = null;
      current = { path: extractFilePath(line), meta: [], hunks: [], binary: false };
      files.push(current);
    } else if (!current) {
      continue;
    } else if (line.startsWith("rename from ")) {
      renameFrom = line.replace("rename from ", "");
    } else if (line.startsWith("rename to ")) {
      renameTo = line.replace("rename to ", "");
    } else if (line.startsWith("new file ")) {
      current.meta.push("new file");
    } else if (line.startsWith("deleted file ")) {
      current.meta.push("deleted");
    } else if (line.startsWith("Binary files ") && line.endsWith(" differ")) {
      current.binary = true;
    } else if (
      line.startsWith("index ") ||
      line.startsWith("similarity ") ||
      line.startsWith("old mode ") ||
      line.startsWith("new mode ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      // Skip noise
    } else {
      current.hunks.push(line);
    }
  }

  if (current && renameFrom && renameTo) {
    finalizeRename({ file: current, from: renameFrom, to: renameTo });
  }

  // Detect LFS / git-annex pointer content and treat as binary
  for (const file of files) {
    if (!file.binary && isPointerDiff(file.hunks)) {
      file.binary = true;
      file.hunks = [];
    }
  }

  return files;
}

// --- XML parsing for card viewer ---

export function extractNewFileContent(hunks: string[]): string {
  return hunks
    .filter((line) => !line.startsWith("@@"))
    .map((line) => (line.startsWith("+") ? line.substring(1) : line))
    .join("\n");
}

