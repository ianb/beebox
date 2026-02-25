/**
 * CommitDetail - Right panel showing commit metadata, diff, and session log.
 * Uses a tabbed interface: Commit | Diff (N) | New (N) | Moved (N) | Session
 */

import { useState, useEffect, useMemo } from "react";
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
    triage: "bg-iris-100 text-plum",
    analyze: "bg-amber-100 text-amber-700",
    brief: "bg-green-100 text-green-700",
  };

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[phase] || "bg-warm-100 text-warm-700"}`}>
      {phase}
    </span>
  );
}

// --- Diff parsing ---

function extractFilePath(line: string): string {
  const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!match) return line;
  return match[2]!;
}

interface DiffFile {
  path: string;
  meta: string[];
  hunks: string[];
  move?: { basename: string; fromDir: string; toDir: string };
}

function parseDiff(diff: string): DiffFile[] {
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
      // Skip noise
    } else {
      current.hunks.push(line);
    }
  }

  if (current && renameFrom && renameTo) {
    finalizeRename({ file: current, from: renameFrom, to: renameTo });
  }

  return files;
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

// --- XML parsing for card viewer ---

function extractNewFileContent(hunks: string[]): string {
  return hunks
    .filter((line) => !line.startsWith("@@"))
    .map((line) => (line.startsWith("+") ? line.substring(1) : line))
    .join("\n");
}

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

// --- Trailer helpers ---

function stripTrailers(body: string): string {
  const lines = body.split("\n");
  const filtered = lines.filter(
    (line) => !/^(Session|Phase|Triggered-By|Feedback-Source|Agent|Items-Processed):\s/.test(line)
  );
  return filtered.join("\n").trim();
}

// --- Tab content components ---

function CommitTab({ commit, bodyText }: { commit: HistoryCommit; bodyText: string }) {
  const phase = trailerString(commit.trailers?.Phase);
  const triggeredBy = trailerString(commit.trailers?.["Triggered-By"]);

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <code className="text-xs bg-warm-100 px-1.5 py-0.5 rounded text-warm-700">
          {commit.hash.substring(0, 8)}
        </code>
        <span className="text-xs text-warm-500">
          {new Date(commit.date).toLocaleString()}
        </span>
        {phase ? <PhaseBadge phase={phase} /> : null}
        {triggeredBy ? <span className="text-xs bg-warm-100 text-warm-700 px-1.5 py-0.5 rounded">
            {triggeredBy}
          </span> : null}
      </div>
      <h2 className="font-medium text-warm-900">{commit.subject}</h2>
      {bodyText ? <div className="mt-2 prose prose-sm max-w-none text-warm-700">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyText}</ReactMarkdown>
        </div> : null}
    </div>
  );
}

function DiffTab({ files }: { files: DiffFile[] }) {
  if (files.length === 0) {
    return <div className="text-sm text-warm-500 italic p-4">No edited files</div>;
  }

  return (
    <div className="divide-y divide-warm-300">
      {files.map((file, fi) => (
        <div key={fi}>
          <div className="px-3 py-1.5 bg-warm-50 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-medium text-warm-700">{file.path}</span>
            {file.meta.filter((m) => m !== "new file" && m !== "deleted" && m !== "moved").map((m, mi) => (
              <span key={mi} className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">{m}</span>
            ))}
          </div>
          <pre className="text-xs font-mono px-3 py-1 leading-relaxed whitespace-pre-wrap break-words">
            {file.hunks.map((line, i) => {
              let className = "text-warm-700";
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

function NewFilesTab({ files }: { files: DiffFile[] }) {
  if (files.length === 0) {
    return <div className="text-sm text-warm-500 italic p-4">No new files</div>;
  }

  return (
    <div className="divide-y divide-warm-300">
      {files.map((file, fi) => {
        const isCard = file.path.endsWith(".card");
        const content = file.hunks.some((h) => h.trim()) ? extractNewFileContent(file.hunks) : null;
        const cardElement = isCard && content ? parseXmlToElementNode(content) : null;

        return (
          <div key={fi}>
            <div className="px-3 py-1.5 bg-green-50 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-green-800">{file.path}</span>
            </div>
            {cardElement ? (
              <CardTreeView element={cardElement} />
            ) : content ? (
              <pre className="text-xs font-mono px-3 py-1 leading-relaxed whitespace-pre-wrap break-words text-warm-700">
                {content.split("\n").map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </pre>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MovedTab({ files }: { files: DiffFile[] }) {
  if (files.length === 0) {
    return <div className="text-sm text-warm-500 italic p-4">No moved files</div>;
  }

  return (
    <div className="px-3 py-2">
      {files.map((file, fi) => (
        <div key={fi} className="text-xs text-warm-700 py-0.5">
          {file.move ? (
            <div>
              <div>{file.move.basename} <span className="text-warm-500">moved</span></div>
              <div className="text-warm-500 ml-3">
                {file.move.fromDir} → {file.move.toDir}
              </div>
            </div>
          ) : (
            <div>
              {file.path}
              {file.meta.map((m, mi) => (
                <span key={mi} className="text-warm-500 ml-1">({m})</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Main component ---

type TabId = "commit" | "diff" | "new" | "moved" | "session";

export function CommitDetail({ commit }: CommitDetailProps) {
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("commit");

  const sessionId = trailerString(commit.trailers?.Session);
  const bodyText = commit.body ? stripTrailers(commit.body) : "";

  // Track commit hash to reset state on change
  const [loadedHash, setLoadedHash] = useState<string | null>(null);
  if (loadedHash !== commit.hash) {
    setLoadedHash(commit.hash);
    setDiff(null);
    setDiffLoading(true);
    setActiveTab("commit");
  }

  useEffect(() => {
    let cancelled = false;
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

  // Parse diff into categories
  const { editedFiles, newFiles, movedFiles, deletedFiles } = useMemo(() => {
    if (!diff) return { editedFiles: [], newFiles: [], movedFiles: [], deletedFiles: [] };
    const files = parseDiff(diff);
    return {
      movedFiles: files.filter((f) => f.meta.includes("moved") && !f.hunks.some((h) => h.trim())),
      newFiles: files.filter((f) => f.meta.includes("new file")),
      deletedFiles: files.filter((f) => f.meta.includes("deleted")),
      editedFiles: files.filter((f) =>
        !f.meta.includes("new file") && !f.meta.includes("deleted") &&
        !(f.meta.includes("moved") && !f.hunks.some((h) => h.trim()))
      ),
    };
  }, [diff]);

  // Build tab list — only show tabs with content (Commit always shows)
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "commit", label: "Commit" },
  ];

  if (diffLoading) {
    tabs.push({ id: "diff", label: "Diff" });
  } else if (diff !== null) {
    if (editedFiles.length > 0 || deletedFiles.length > 0) {
      tabs.push({ id: "diff", label: "Diff", count: editedFiles.length + deletedFiles.length });
    }
    if (newFiles.length > 0) {
      tabs.push({ id: "new", label: "New", count: newFiles.length });
    }
    if (movedFiles.length > 0) {
      tabs.push({ id: "moved", label: "Moved", count: movedFiles.length });
    }
  }

  if (sessionId) {
    tabs.push({ id: "session", label: "Session" });
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b bg-warm-50 px-2 pt-1 gap-1 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
              activeTab === tab.id
                ? "bg-white text-warm-900 border border-b-white border-warm-300 -mb-px"
                : "text-warm-600 hover:text-warm-700 hover:bg-warm-100"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`ml-1 ${activeTab === tab.id ? "text-warm-600" : "text-warm-500"}`}>
                ({tab.count})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "commit" && (
          <CommitTab commit={commit} bodyText={bodyText} />
        )}
        {activeTab === "diff" && (
          diffLoading
            ? <div className="text-sm text-warm-500 italic p-4">Loading...</div>
            : <DiffTab files={[...editedFiles, ...deletedFiles]} />
        )}
        {activeTab === "new" && (
          <NewFilesTab files={newFiles} />
        )}
        {activeTab === "moved" && (
          <MovedTab files={movedFiles} />
        )}
        {activeTab === "session" && sessionId ? <SessionLog sessionId={sessionId} /> : null}
      </div>
    </div>
  );
}
