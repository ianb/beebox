/**
 * CommitDetail diff parsing — pure helpers for turning a unified git diff
 * into structured DiffFile records, plus new-file content extraction.
 */

import { invariant } from "../../lib/invariant";

export interface DiffFile {
  path: string;
  meta: string[];
  hunks: string[];
  binary: boolean;
  move?: { basename: string; fromDir: string; toDir: string };
}

function extractFilePath(line: string): string {
  const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!match) return line;
  const path = match[2];
  invariant(path !== undefined, "diff --git line matched but the 'b/' path group is missing");
  return path;
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
 * Detect Git LFS pointer content in diff hunks.
 * LFS pointers are small text files starting with "version https://git-lfs.github.com/spec/v1".
 */
function isLfsPointer(hunks: string[]): boolean {
  const added = hunks.filter((l) => l.startsWith("+")).map((l) => l.slice(1));
  return added.some((l) => l.startsWith("version https://git-lfs.github.com/spec/v1"));
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

  // Detect LFS pointer content and treat as binary
  for (const file of files) {
    if (!file.binary && isLfsPointer(file.hunks)) {
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

