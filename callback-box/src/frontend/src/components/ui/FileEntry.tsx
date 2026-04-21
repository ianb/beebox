/**
 * FileEntry — canonical one-line representation of a file, shared across
 * the recent-files dropdown, tool-use expansions, and future surfaces.
 *
 * Fixed frame: [icon] [middle slot] [peek button]. The middle slot is
 * either the default (title + optional path) or a custom ListComponent
 * registered via registerFileType for the file's tagName / path.
 *
 * Expanded state ("peek") replaces the list row in place: same component,
 * same location, now rendering the full file viewer + controls to escalate
 * to a companion panel or open as a full page.
 */

import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import type { FileSummary } from "../../../../core/file-summary";
import { resolveFileTypeUI } from "../../file-types/registry";
import { cn } from "../../lib/cn";
import { FileView } from "../FileView";
import { href } from "../../lib/routing";
import { useViewNavigate } from "../../hooks/useViewNavigate";

interface FileEntryProps {
  summary: FileSummary<unknown>;
  /**
   * When true, hide the path in the default middle slot and pass compact=true
   * to any custom ListComponent. Start with CSS where possible; use this when
   * the container *knows* it's narrow (e.g. nested in a dropdown on mobile).
   */
  compact?: boolean;
  /**
   * Called when the user escalates from peek to the persistent side panel.
   * Wiring depends on the surrounding context; if omitted, the panel button
   * is not shown.
   */
  onPanel?: (summary: FileSummary<unknown>) => void;
  /** Outer-layout classes only (margin, flex-self, sizing, position). */
  className?: string;
}

function PeekIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M13 4v16" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

function DefaultMiddle({ data, compact }: { data: FileSummary<unknown>; compact: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-warm-800 font-medium">{data.title}</div>
      {compact ? null : (
        <div className="truncate text-xs text-warm-500" title={data.path}>
          {data.path}
        </div>
      )}
    </div>
  );
}

const rightIconClass = "flex-shrink-0 p-1.5 rounded text-warm-500 hover:text-warm-700 hover:bg-warm-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function ExpandedControls({
  summary, boxSlug, onCollapse, onPanel,
}: {
  summary: FileSummary<unknown>;
  boxSlug: string | undefined;
  onCollapse: () => void;
  onPanel?: (summary: FileSummary<unknown>) => void;
}) {
  const pageHref = boxSlug ? href(`/${boxSlug}/browse/${summary.path}`) : undefined;
  return (
    <>
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Collapse"
        title="Collapse"
        className={rightIconClass}
      >
        <CollapseIcon />
      </button>
      {onPanel ? (
        <button
          type="button"
          onClick={() => onPanel(summary)}
          aria-label="Open as side panel"
          title="Open as side panel"
          className={rightIconClass}
        >
          <PanelIcon />
        </button>
      ) : null}
      {pageHref ? (
        <a
          href={pageHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open as full page (new tab)"
          title="Open as full page (new tab)"
          className={rightIconClass}
        >
          <PageIcon />
        </a>
      ) : null}
    </>
  );
}

export function FileEntry({ summary, compact = false, onPanel, className }: FileEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const ui = resolveFileTypeUI(summary);
  const Icon = ui.icon;
  const ListComponent = ui.ListComponent;
  const { boxSlug } = useParams({ strict: false });
  const handleNavigate = useViewNavigate();

  const titleSlot = (
    <div className="flex-1 min-w-0 flex items-center gap-2">
      <span className="flex-shrink-0 text-warm-500">
        <Icon size={18} />
      </span>
      <div className="flex-1 min-w-0">
        {ListComponent ? (
          <ListComponent data={summary} compact={compact} />
        ) : (
          <DefaultMiddle data={summary} compact={compact} />
        )}
      </div>
    </div>
  );

  if (expanded) {
    return (
      <div
        className={cn(
          "border border-warm-300 rounded bg-white overflow-hidden",
          className,
        )}
        data-file-path={summary.path}
      >
        <div className="flex items-center gap-1 min-w-0 py-1.5 px-2">
          {titleSlot}
          <ExpandedControls
            summary={summary}
            boxSlug={boxSlug}
            onCollapse={() => setExpanded(false)}
            onPanel={onPanel}
          />
        </div>
        <div className="border-t border-warm-200">
          <FileView path={summary.path} mode="companion" onNavigate={handleNavigate} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-center gap-1 min-w-0 rounded hover:bg-warm-100 transition-colors", className)}
      data-file-path={summary.path}
    >
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Preview ${summary.title}`}
        className="flex-1 flex items-center min-w-0 py-1.5 px-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
      >
        {titleSlot}
      </button>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="Preview"
        title="Preview"
        className={rightIconClass}
      >
        <PeekIcon />
      </button>
      {onPanel ? (
        <button
          type="button"
          onClick={() => onPanel(summary)}
          aria-label="Open as side panel"
          title="Open as side panel"
          className={rightIconClass}
        >
          <PanelIcon />
        </button>
      ) : null}
    </div>
  );
}
