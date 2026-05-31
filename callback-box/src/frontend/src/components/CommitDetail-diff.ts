/**
 * CommitDetail diff parsing — pure helpers for turning a unified git diff
 * into structured DiffFile records, plus XML/card content extraction.
 */

import type { ElementNode } from "./CardTreeView";

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
  return match[2]!;
}

interface FinalizeRenameParams {
  file: DiffFile;
  from: string;
  to: string;
}

function finalizeRename(params: FinalizeRenameParams): void {
  const { file, from, to } = params;
  file.path = to;
  const fromName = from.split("/").pop()!;
  const toName = to.split("/").pop()!;
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

function dedent(s: string): string {
  const lines = s.split("\n");
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length === 0) return s.trim();
  const indent = Math.min(
    ...nonEmptyLines.map((l) => l.match(/^(\s*)/)![0].length)
  );
  return lines.map((l) => l.slice(indent)).join("\n").trim();
}

function domToElementNode(el: Element): ElementNode {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    attrs[attr.name] = attr.value;
  }

  const children: ElementNode[] = [];
  let text = "";

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      children.push(domToElementNode(child as Element));
    } else if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
      const t = child.textContent;
      if (t) text += t;
    }
  }

  const dedented = dedent(text);

  return {
    tagName: el.tagName,
    attrs,
    ...(dedented ? { text: dedented } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

export function parseXmlToElementNode(xml: string): ElementNode | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const error = doc.querySelector("parsererror");
    if (error) return null;
    return domToElementNode(doc.documentElement);
  } catch (_e) {
    // Unparseable XML — caller treats null as "not renderable".
    return null;
  }
}
