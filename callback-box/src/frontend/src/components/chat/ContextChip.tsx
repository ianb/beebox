/**
 * The chat header's context chip: a Dropdown-triggered chip on the left,
 * next to the "Chat" title, replacing `ChatContextLink`, `LandmarkLinksButton`,
 * and `RecentFilesButton`'s header triggers (chunk 4 of
 * docs/plans/chat-header-chips.md).
 *
 * Face: the landmark label if one resolved, else the context dir's basename,
 * else "Box root" (`dir === ""`) or "Files" (`dir === null`) — see
 * `context-chip-label.ts`. The face always renders something immediately; a
 * slow/failed landmark query just means the label falls back to the dir
 * basename until (if) the query resolves — the label is an upgrade, not a
 * dependency.
 *
 * Menu root: the "Open <dir>/" browse link (only when there's a context
 * dir), the landmark's links/groups (via `LandmarkLinksPanel`, absent when
 * there are none), a divider, and "Recent files ›" leading to the
 * `RecentFilesPanel` sub-panel.
 */

import { useState, type ReactNode } from "react";
import { Dropdown, MenuItem, MenuDivider } from "../ui/Dropdown";
import { withBase } from "../../api";
import { trpc } from "../../lib/trpc";
import { contextChipLabel } from "./context-chip-label";
import { LandmarkLinksPanel } from "./LandmarkLinksPanel";
import { RecentFilesPanel } from "./RecentFilesPanel";
import type { SessionEntry } from "../../api";
import type { OnZoomView } from "./ChatMessages";

// Single-panel submenu pattern (see ChatMenu.tsx): the dropdown swaps which
// set of rows it renders rather than spawning a flyout. Resets to "root"
// when the dropdown closes.
type ContextChipPanel = "root" | "recent-files";

interface ResolvedLink {
  ref: string;
  label: string | null;
  title: string;
  exists: boolean;
}

/**
 * "Open <dir>/" browse link — only rendered when there's a context dir (root
 * included). `MenuItem`'s `href` variant already closes the dropdown on
 * click, matching the old `ChatContextLink` behavior. The root dir (`""`)
 * gets its own href without a trailing slash — `BrowsePageWrapper`
 * (`app-shell.tsx`) itself omits the trailing slash for an empty path, and a
 * splat route shouldn't rely on trailing-slash equivalence to reach the same
 * page.
 */
function OpenDirLink({ dir, boxSlug }: { dir: string; boxSlug: string }) {
  const href = dir === "" ? withBase(`/${boxSlug}/browse`) : withBase(`/${boxSlug}/browse/${dir}`);
  return (
    <MenuItem href={href}>
      Open {dir}/
    </MenuItem>
  );
}

/**
 * The chip's `title` (hover tooltip): the full context path, distinct from
 * the (possibly landmark-labeled) face text — per the plan, `title` always
 * shows the path, not the display label. There's no path when there's no
 * context at all (`dir === null`); the label ("Files") is the closest thing.
 */
function contextChipTitle({ dir, label }: { dir: string | null; label: string }): string {
  if (dir === null) return label;
  return dir === "" ? "/" : `${dir}/`;
}

function RootPanel({
  dir,
  boxSlug,
  onLandmarkPanel,
  onOpenRecentFiles,
}: {
  dir: string | null;
  boxSlug: string;
  onLandmarkPanel: (link: ResolvedLink) => void;
  onOpenRecentFiles: () => void;
}) {
  return (
    <>
      {dir !== null ? <OpenDirLink dir={dir} boxSlug={boxSlug} /> : null}
      <LandmarkLinksPanel contextDir={dir} onPanel={onLandmarkPanel} />
      <MenuDivider />
      <MenuItem onClick={onOpenRecentFiles} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Recent files</span>
          <span className="text-warm-500">›</span>
        </span>
      </MenuItem>
    </>
  );
}

function RecentFilesSubPanel({
  onBack,
  messages,
  onFilePanel,
}: {
  onBack: () => void;
  messages: SessionEntry[];
  onFilePanel: RecentFilesPanelFileHandler;
}) {
  return (
    <>
      <MenuItem onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Recent files</span>
      </MenuItem>
      <MenuDivider />
      <RecentFilesPanel entries={messages} onPanel={onFilePanel} />
    </>
  );
}

type RecentFilesPanelFileHandler = Parameters<typeof RecentFilesPanel>[0]["onPanel"];

interface ContextChipBodyProps {
  panel: ContextChipPanel;
  dir: string | null;
  boxSlug: string;
  messages: SessionEntry[];
  onLandmarkPanel: (link: ResolvedLink) => void;
  onFilePanel: RecentFilesPanelFileHandler;
  onOpenRecentFiles: () => void;
  onBackToRoot: () => void;
}

/**
 * Exhaustive panel dispatch — a `switch` with no `default:` (the frontend
 * `.tsx` rule bans `default:` cases outright; TypeScript's
 * switch-exhaustiveness check still catches an unhandled new
 * `ContextChipPanel` member at compile time without one).
 */
function ContextChipBody(props: ContextChipBodyProps): ReactNode {
  const { panel, dir, boxSlug, messages, onLandmarkPanel, onFilePanel, onOpenRecentFiles, onBackToRoot } = props;
  switch (panel) {
    case "root":
      return <RootPanel dir={dir} boxSlug={boxSlug} onLandmarkPanel={onLandmarkPanel} onOpenRecentFiles={onOpenRecentFiles} />;
    case "recent-files":
      return <RecentFilesSubPanel onBack={onBackToRoot} messages={messages} onFilePanel={onFilePanel} />;
  }
}

export function ContextChip({
  dir,
  boxSlug,
  messages,
  onZoomView,
}: {
  dir: string | null;
  boxSlug: string | undefined;
  messages: SessionEntry[];
  onZoomView: OnZoomView;
}) {
  const [panel, setPanel] = useState<ContextChipPanel>("root");
  // Same query LandmarkLinksPanel drives — react-query dedupes identical
  // keys, so this doesn't double-fetch. Kept here (not in LandmarkLinksPanel)
  // so that file stays a single-component module (PascalCase naming rule).
  const { data: landmarkData } = trpc.landmarks.forDir.useQuery(
    { dir: dir ?? "" },
    { enabled: dir !== null },
  );
  const landmarkLabel = landmarkData?.landmark?.label ?? null;
  const label = contextChipLabel({ landmarkLabel, dir });
  const title = contextChipTitle({ dir, label });
  const slug = boxSlug ?? "";

  const onLandmarkPanel = (link: ResolvedLink) => {
    onZoomView({
      target: { path: link.ref, viewer: null, params: {} },
      label: link.label ?? link.title,
    });
  };
  const onFilePanel: RecentFilesPanelFileHandler = (summary) => {
    onZoomView({
      target: { path: summary.path, viewer: null, params: {} },
      label: summary.title,
    });
  };

  return (
    <Dropdown
      align="left"
      width="w-[24rem]"
      className="min-w-0"
      onClose={() => setPanel("root")}
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          onClick={toggle}
          className="min-h-[40px] min-w-0 px-2 flex items-center rounded hover:bg-white/20 text-white/80 hover:text-white text-xs truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={title}
          aria-label={`Context: ${label}`}
          {...ariaProps}
        >
          <span className="min-w-0 truncate">{label}</span>
        </button>
      )}
    >
      <ContextChipBody
        panel={panel}
        dir={dir}
        boxSlug={slug}
        messages={messages}
        onLandmarkPanel={onLandmarkPanel}
        onFilePanel={onFilePanel}
        onOpenRecentFiles={() => setPanel("recent-files")}
        onBackToRoot={() => setPanel("root")}
      />
    </Dropdown>
  );
}
