/**
 * The chat's "here" menu body — the full form of the app bar's here menu
 * (docs/plans/top-nav-ia.md Track C2). Lifted verbatim out of the retired
 * `ContextChip`: its trigger and Dropdown died with the chat header row, but
 * its body is still the richest here menu we have, and it can only be built
 * from chat state — `messages` feeds "Recent files", and rows open in the
 * companion pane via `onZoomView`. The bar's own reduced menu
 * (`components/PlacePill-here.tsx`) is what non-chat pages get.
 *
 * Rendered into the pill's open here-Dropdown through `createPortal`
 * (`ChatBarChrome`), so it keeps this tree's React context — hence
 * `PortaledMenuScope` around it on the caller's side, or its `MenuItem`s
 * couldn't dismiss the menu.
 *
 * Rows: "Open <dir>/" (only with a context dir), the landmark's links/groups
 * (`LandmarkLinksPanel`, absent when there are none), a divider, and
 * "Recent files ›" leading to the `RecentFilesPanel` sub-panel.
 *
 * The panel swap is local state here rather than the `Dropdown`'s
 * `panelIndex`, which lives on the far side of the portal: the rows still
 * swap in place and `Dropdown`'s focus re-anchor observer still fires (it
 * watches any DOM change while open), but the directional slide animation
 * doesn't play for this menu. Reuniting them would mean publishing panel
 * depth back up through the chrome for one CSS transition.
 *
 * `React.memo` is load-bearing: the chat root re-renders on every streaming
 * token, and this body hangs off it. `messages` changes only when history
 * lands (not per token) and `onZoomView` is a `[]`-dep callback, so the memo
 * holds across a streamed turn.
 */

import { memo, useState, type ReactNode } from "react";
import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { href } from "../../lib/routing";
import { toDisplayPath } from "@shared/display-path";
import { LandmarkLinksPanel } from "./LandmarkLinksPanel";
import { RecentFilesPanel } from "./RecentFilesPanel";
import type { SessionEntry } from "../../api";
import type { OnZoomView } from "./ChatMessages";

type ContextMenuPanel = "root" | "recent-files";

interface ResolvedLink {
  ref: string;
  label: string | null;
  title: string;
  exists: boolean;
}

type RecentFilesPanelFileHandler = Parameters<typeof RecentFilesPanel>[0]["onPanel"];

/**
 * "Open <dir>/" browse link — only rendered when there's a context dir (root
 * included). `MenuItem`'s `to` variant keeps this an in-app navigation and
 * closes the dropdown on click. The root dir (`""`) gets its own path without
 * a trailing slash —
 * `BrowsePageWrapper` (`app-shell.tsx`) itself omits the trailing slash for
 * an empty path, and a splat route shouldn't rely on trailing-slash
 * equivalence to reach the same page.
 */
function OpenDirLink({ dir, boxSlug }: { dir: string; boxSlug: string }) {
  const path = dir === "" ? `/${boxSlug}/browse` : `/${boxSlug}/browse/${dir}`;
  const display = toDisplayPath(dir);
  return (
    <MenuItem id="bbx-here-open-dir" to={href(path)}>
      Open {display === "/" ? display : `${display}/`}
    </MenuItem>
  );
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
      <MenuItem id="bbx-here-recent-files" onClick={onOpenRecentFiles} keepOpen>
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
      <MenuItem id="bbx-here-recent-files-back" onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Recent files</span>
      </MenuItem>
      <MenuDivider />
      <RecentFilesPanel entries={messages} onPanel={onFilePanel} />
    </>
  );
}

export interface ContextMenuBodyProps {
  /** Box-relative context dir: `""` for root, `null` for no context. */
  dir: string | null;
  boxSlug: string;
  messages: SessionEntry[];
  onZoomView: OnZoomView;
}

export const ContextMenuBody = memo(function ContextMenuBody(props: ContextMenuBodyProps): ReactNode {
  const { dir, boxSlug, messages, onZoomView } = props;
  const [panel, setPanel] = useState<ContextMenuPanel>("root");

  const onLandmarkPanel = (link: ResolvedLink) => {
    onZoomView({
      target: { path: link.ref, viewer: null, params: {}, viewState: null },
      label: link.label ?? link.title,
    });
  };
  const onFilePanel: RecentFilesPanelFileHandler = (summary) => {
    onZoomView({
      target: { path: summary.path, viewer: null, params: {}, viewState: null },
      label: summary.title,
    });
  };

  // Exhaustive panel dispatch — a `switch` with no `default:` (the frontend
  // `.tsx` rule bans `default:` cases outright; TypeScript's
  // switch-exhaustiveness check still catches an unhandled new member).
  switch (panel) {
    case "root":
      return (
        <RootPanel
          dir={dir}
          boxSlug={boxSlug}
          onLandmarkPanel={onLandmarkPanel}
          onOpenRecentFiles={() => setPanel("recent-files")}
        />
      );
    case "recent-files":
      return <RecentFilesSubPanel onBack={() => setPanel("root")} messages={messages} onFilePanel={onFilePanel} />;
  }
});

/**
 * The Recent-files list alone — the body the chat portals into the switch
 * menu's "Recent files ›" sub-panel (`AppBarRecentFilesSlot`; the back row
 * lives on the bar side, where the panel state is). Memoized with the same
 * stable-props discipline as `ContextMenuBody` above: `messages` changes when
 * a turn lands, not per token, and `onZoomView` is a `[]`-dep callback.
 */
export const RecentFilesMenuBody = memo(function RecentFilesMenuBody({
  messages,
  onZoomView,
}: {
  messages: SessionEntry[];
  onZoomView: OnZoomView;
}): ReactNode {
  const onFilePanel: RecentFilesPanelFileHandler = (summary) => {
    onZoomView({
      target: { path: summary.path, viewer: null, params: {}, viewState: null },
      label: summary.title,
    });
  };
  return <RecentFilesPanel entries={messages} onPanel={onFilePanel} />;
});
