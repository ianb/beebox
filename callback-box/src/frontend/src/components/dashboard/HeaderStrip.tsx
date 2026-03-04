/**
 * Dashboard header strip — box name, connection status, inline action buttons.
 */

import { useState, useRef, useEffect } from "react";
import type { RouterOutput } from "../../lib/trpc";

type StatusResponse = RouterOutput["status"]["status"];

interface HeaderStripProps {
  status: StatusResponse | null;
  connected: boolean;
  onAction: (action: "wakeup" | "sync" | "create-memo" | "process-news") => void;
}

function GitStatusPopover({ git }: { git: StatusResponse["git"] }) {
  const { staged, modified, untracked } = git;
  const sections: Array<{ label: string; files: string[]; color: string }> = [];
  if (staged.length > 0) sections.push({ label: "Staged", files: staged, color: "text-green-700" });
  if (modified.length > 0) sections.push({ label: "Modified", files: modified, color: "text-yellow-700" });
  if (untracked.length > 0) sections.push({ label: "Untracked", files: untracked, color: "text-warm-600" });

  return (
    <div className="fixed left-[10vw] top-24 w-[80vw] bg-white border rounded-lg shadow-lg z-10 p-3 text-xs">
      {git.clean ? (
        <p className="text-green-600">Working tree clean</p>
      ) : (
        <div className="space-y-2">
          {sections.map((s) => (
            <div key={s.label}>
              <div className={`font-semibold ${s.color} mb-0.5`}>
                {s.label} ({s.files.length})
              </div>
              <ul className="font-mono text-warm-700 space-y-0.5 max-h-32 overflow-auto">
                {s.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HeaderStrip({ status, connected, onAction }: HeaderStripProps) {
  const [showGit, setShowGit] = useState(false);
  const gitRef = useRef<HTMLDivElement>(null);
  const boxRoot = status?.boxRoot;
  const boxName = boxRoot?.split("/").pop() ?? "Box";

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (gitRef.current && !gitRef.current.contains(e.target as Node)) {
        setShowGit(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-3 bg-white border-b">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold text-warm-900 truncate">{boxName}</h1>
          {boxRoot ? (
            <div className="text-xs text-warm-500 font-mono truncate hidden sm:block">{boxRoot}</div>
          ) : null}
        </div>
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? "bg-green-500" : "bg-red-400"}`}
          title={connected ? "Connected" : "Disconnected"}
        />
        {status ? (
          <div className="relative" ref={gitRef}>
            <button
              onClick={() => setShowGit(!showGit)}
              className={`text-sm px-2 py-0.5 rounded hover:bg-warm-100 whitespace-nowrap ${
                status.git.clean ? "text-green-600" : "text-yellow-600"
              }`}
            >
              {status.git.clean ? "clean" : `dirty (${status.git.modified.length + status.git.untracked.length} files)`}
            </button>
            {showGit ? <GitStatusPopover git={status.git} /> : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          onClick={() => onAction("create-memo")}
          className="btn btn-success text-sm"
        >
          + Memo
        </button>
        <button
          onClick={() => onAction("wakeup")}
          className="btn btn-secondary text-sm font-mono"
        >
          wakeup
        </button>
        <button
          onClick={() => onAction("sync")}
          className="btn btn-secondary text-sm font-mono"
        >
          sync
        </button>
      </div>
    </div>
  );
}
