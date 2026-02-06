/**
 * CommitDetail - Right panel showing commit metadata, diff, and session log.
 */

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getCommitDiff, type HistoryCommit } from "../api";
import { SessionLog } from "./SessionLog";
import { CardTreeView, type ElementNode } from "./CardTreeView";

interface CommitDetailProps {
  commit: HistoryCommit;
}

/**
 * Get trailer value as string (first value if array).
 */
function trailerString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Phase badge with color coding.
 */
function PhaseBadge({ phase }: { phase: string }) {
  const colors: Record<string, string> = {
    triage: "bg-blue-100 text-blue-700",
    analyze: "bg-amber-100 text-amber-700",
    brief: "bg-green-100 text-green-700",
  };

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[phase] || "bg-gray-100 text-gray-600"}`}>
      {phase}
    </span>
  );
}

/**
 * Extract a readable file path from a diff --git line.
 */
function extractFilePath(line: string): string {
  // "diff --git a/path/to/file b/path/to/file" → "path/to/file"
  const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!match) return line;
  return match[2]!;
}

/**
 * Parse diff into structured file sections for cleaner display.
 */
interface DiffFile {
  path: string;
  meta: string[]; // compact metadata labels
  hunks: string[];
  // For moves: structured info for compact display
  move?: { basename: string; fromDir: string; toDir: string };
}

function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // Finalize previous rename if any
      if (current && renameFrom && renameTo) {
        finalizeRename(current, renameFrom, renameTo);
      }
      renameFrom = null;
      renameTo = null;
      current = { path: extractFilePath(line), meta: [], hunks: [] };
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
    } else if (
      line.startsWith("index ") ||
      line.startsWith("similarity ") ||
      line.startsWith("old mode ") ||
      line.startsWith("new mode ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      // Skip noise lines
    } else {
      current.hunks.push(line);
    }
  }

  // Finalize last file's rename
  if (current && renameFrom && renameTo) {
    finalizeRename(current, renameFrom, renameTo);
  }

  return files;
}

/**
 * For renames, show the destination path and a compact label.
 * If only the directory changed (same filename), show "moved".
 * If the filename also changed, show "renamed from old-name".
 */
function finalizeRename(file: DiffFile, from: string, to: string): void {
  file.path = to;
  const fromName = from.split("/").pop()!;
  const toName = to.split("/").pop()!;
  if (fromName === toName) {
    // Just moved directories — store structured info
    const fromDir = from.substring(0, from.length - fromName.length) || "/";
    const toDir = to.substring(0, to.length - toName.length) || "/";
    file.move = { basename: toName, fromDir, toDir };
    file.meta.push("moved");
  } else {
    file.meta.push(`renamed from ${from}`);
  }
}

/**
 * Extract file content from new-file diff hunks (strip + prefix and @@ lines).
 */
function extractNewFileContent(hunks: string[]): string {
  return hunks
    .filter((line) => !line.startsWith("@@"))
    .map((line) => (line.startsWith("+") ? line.substring(1) : line))
    .join("\n");
}

/**
 * Parse XML string into an ElementNode tree using the browser's DOMParser.
 * Returns null if parsing fails.
 */
function parseXmlToElementNode(xml: string): ElementNode | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const error = doc.querySelector("parsererror");
    if (error) return null;
    return domToElementNode(doc.documentElement);
  } catch {
    return null;
  }
}

/**
 * Remove common leading whitespace from all lines (dedent).
 */
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

/**
 * Render a unified diff with color highlighting, organized by file.
 */
function DiffView({ diff }: { diff: string }) {
  if (!diff) {
    return <div className="text-sm text-gray-400 italic p-4">No changes</div>;
  }

  const files = parseDiff(diff);

  if (files.length === 0) {
    return <div className="text-sm text-gray-400 italic p-4">No content changes (rename/mode only)</div>;
  }

  // Moves/renames without content changes go in compact summary.
  // New files show their content plainly (not as a diff).
  // Deleted files just get a label.
  // Edited files get full colored diffs.
  const movedFiles = files.filter((f) => f.meta.includes("moved") && !f.hunks.some((h) => h.trim()));
  const newFiles = files.filter((f) => f.meta.includes("new file"));
  const deletedFiles = files.filter((f) => f.meta.includes("deleted"));
  const editedFiles = files.filter((f) =>
    !f.meta.includes("new file") && !f.meta.includes("deleted") &&
    !(f.meta.includes("moved") && !f.hunks.some((h) => h.trim()))
  );

  return (
    <div className="divide-y divide-gray-200">
      {/* Moved/renamed files shown compactly */}
      {movedFiles.length > 0 && (
        <div className="px-3 py-2">
          {movedFiles.map((file, fi) => (
            <div key={fi} className="text-xs text-gray-600 py-0.5">
              {file.move ? (
                <div>
                  <div>{file.move.basename} <span className="text-gray-400">moved</span></div>
                  <div className="text-gray-400 ml-3">
                    {file.move.fromDir} → {file.move.toDir}
                  </div>
                </div>
              ) : (
                <div>
                  {file.path}
                  {file.meta.map((m, mi) => (
                    <span key={mi} className="text-gray-400 ml-1">({m})</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New files: card viewer for .card files, plain text for others */}
      {newFiles.map((file, fi) => {
        const isCard = file.path.endsWith(".card");
        const content = file.hunks.some((h) => h.trim()) ? extractNewFileContent(file.hunks) : null;
        const cardElement = isCard && content ? parseXmlToElementNode(content) : null;

        return (
          <div key={fi}>
            <div className="px-3 py-1.5 bg-green-50 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-green-800">{file.path}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">new file</span>
            </div>
            {cardElement ? (
              <CardTreeView element={cardElement} />
            ) : content ? (
              <pre className="text-xs font-mono px-3 py-1 leading-relaxed whitespace-pre-wrap break-words text-gray-600">
                {content.split("\n").map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </pre>
            ) : null}
          </div>
        );
      })}

      {/* Deleted files: just the label */}
      {deletedFiles.length > 0 && (
        <div className="px-3 py-2">
          {deletedFiles.map((file, fi) => (
            <div key={fi} className="text-xs text-gray-600 py-0.5">
              {file.path} <span className="text-red-400">(deleted)</span>
            </div>
          ))}
        </div>
      )}

      {/* Edited files: full colored diff */}
      {editedFiles.map((file, fi) => (
        <div key={fi}>
          <div className="px-3 py-1.5 bg-gray-50 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-medium text-gray-700">{file.path}</span>
            {file.meta.map((m, mi) => (
              <span key={mi} className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">{m}</span>
            ))}
          </div>
          <pre className="text-xs font-mono px-3 py-1 leading-relaxed whitespace-pre-wrap break-words">
            {file.hunks.map((line, i) => {
              let className = "text-gray-600";
              if (line.startsWith("+")) {
                className = "text-green-700 bg-green-50";
              } else if (line.startsWith("-")) {
                className = "text-red-700 bg-red-50";
              } else if (line.startsWith("@@")) {
                className = "text-purple-500 text-[10px]";
              }

              return (
                <div key={i} className={className}>
                  {line}
                </div>
              );
            })}
          </pre>
        </div>
      ))}
    </div>
  );
}

/**
 * Strip known trailer lines from the commit body to avoid duplication.
 */
function stripTrailers(body: string): string {
  const lines = body.split("\n");
  const filtered = lines.filter(
    (line) => !/^(Session|Phase|Triggered-By|Feedback-Source|Agent|Items-Processed):\s/.test(line)
  );
  return filtered.join("\n").trim();
}

export function CommitDetail({ commit }: CommitDetailProps) {
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(true);
  const [showSession, setShowSession] = useState(false);

  const sessionId = trailerString(commit.trailers?.Session);
  const phase = trailerString(commit.trailers?.Phase);
  const triggeredBy = trailerString(commit.trailers?.["Triggered-By"]);
  const bodyText = commit.body ? stripTrailers(commit.body) : "";

  useEffect(() => {
    let cancelled = false;
    setDiffLoading(true);
    setDiff(null);
    getCommitDiff(commit.hash)
      .then((result) => {
        if (!cancelled) setDiff(result.diff);
      })
      .catch((err) => console.error("Failed to load diff:", err))
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => { cancelled = true; };
  }, [commit.hash]);

  // Reset session panel when commit changes
  useEffect(() => {
    setShowSession(false);
  }, [commit.hash]);

  return (
    <div className="h-full overflow-auto">
      {/* Commit metadata */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
            {commit.hash.substring(0, 8)}
          </code>
          <span className="text-xs text-gray-400">
            {new Date(commit.date).toLocaleString()}
          </span>
          {phase && <PhaseBadge phase={phase} />}
          {triggeredBy && (
            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {triggeredBy}
            </span>
          )}
          {sessionId && (
            <button
              onClick={() => setShowSession(!showSession)}
              className="text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
              title={`View session log: ${sessionId}`}
            >
              session {sessionId.substring(0, 8)}...
            </button>
          )}
        </div>
        <h2 className="font-medium text-gray-900">{commit.subject}</h2>
        {bodyText && (
          <div className="mt-2 prose prose-sm max-w-none text-gray-600">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyText}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* Session log section - shown when session ID is clicked */}
      {sessionId && showSession && (
        <div className="border-b">
          <div className="px-4 py-2 bg-indigo-50 flex items-center justify-between">
            <span className="text-sm font-medium text-indigo-700">
              Session Log
              <code className="ml-2 text-xs text-indigo-400 font-normal">
                {sessionId.substring(0, 8)}...
              </code>
            </span>
            <button
              onClick={() => setShowSession(false)}
              className="text-xs text-indigo-400 hover:text-indigo-600"
            >
              close
            </button>
          </div>
          <div className="border-t">
            <SessionLog sessionId={sessionId} />
          </div>
        </div>
      )}

      {/* Diff section */}
      <div className="border-b">
        <button
          onClick={() => setShowDiff(!showDiff)}
          className="w-full px-4 py-2 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <span className={`transition-transform ${showDiff ? "rotate-90" : ""}`}>
            &#9654;
          </span>
          Diff
          {diffLoading && <span className="text-gray-400 font-normal">(loading...)</span>}
        </button>
        {showDiff && diff !== null && (
          <div className="border-t bg-white">
            <DiffView diff={diff} />
          </div>
        )}
      </div>
    </div>
  );
}
