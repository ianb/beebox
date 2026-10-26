import { useEffect, useState, type ReactNode } from "react";
import { useQuestionCloseLabel } from "../../../questions/question-tab";
import { useParams } from "@tanstack/react-router";
import { VisuallyHidden } from "../../../ui/VisuallyHidden";
import { MaterialContext } from "../../../ui/material";
import { FileView } from "../../../FileView/view";
import { SidecarTabStrip } from "../SidecarTabStrip/view";
import { useCompanionMaterial } from "../../../../hooks/useCompanionMaterial";
import { useCardIdentities } from "../../../../hooks/useCardIdentities";
import { cardTypeFromName } from "@shared/card-name";
import { CardVisibilityProvider } from "../../everywhere/card-context/context";
import { useWorkspace } from "../WorkspaceProvider/provider";
import { WorkspacePaneContext } from "../use-open-beside/hook";
import { WorkspaceControls, RestoreCardsControl } from "./WorkspaceControls";
import { isWorkspacePdf } from "./pdf-pane-view";
import { workspacePanelId, workspaceTabId } from "../address";
import { TranscriptFloatingControls } from "../TranscriptFloatingControls";
import { isMarkdownPath } from "../../../file-view-data";
import type { SidecarTab } from "../../sidecar-tabs";
import type { PaneId } from "../state-types.js";
import type { AddSelectionInput } from "../../../../lib/selection/position";
import type { ActivityKind } from "@core/chat/card-activity";
import { withoutFragment } from "../../../../lib/view-url";
import type { SessionContentBlock } from "../../../../api";
import { useTurnEditedPaths } from "./turn-edits";

interface CardCallbacks {
  onAddSelection?: (selection: AddSelectionInput) => void;
  reportActivity: (kind: ActivityKind, detail?: string) => void;
}
function WorkspaceCard({ tab, pane, visible, editing, onAddSelection, reportActivity }: CardCallbacks & { tab: SidecarTab; pane: PaneId; visible: boolean; editing: boolean }) {
  const workspace = useWorkspace();
  const material = useCompanionMaterial(tab.target.path);
  const { boxSlug } = useParams({ strict: false });
  const tabs = workspace ? workspace.tabsForPane(pane) : [];
  const identities = useCardIdentities(tabs.map((item) => item.target.path));
  const closeLabel = useQuestionCloseLabel(tabs.map((item) => item.target.path));
  if (!workspace) return null;
  const { onSelectTab: handleSelectTab, onCloseTab: handleCloseTab, onTogglePin: handleTogglePin } = workspace;
  const workspacePdf = isWorkspacePdf(tab.target.path, tab.target.viewer);
  const themedSurface = cardTypeFromName(tab.target.path) !== undefined || isMarkdownPath(tab.target.path);
  const fileView = <FileView path={tab.target.path} mode="companion" workspacePdf={workspacePdf} rendererName={tab.target.viewer} params={tab.target.params} viewState={tab.target.viewState} fragment={tab.target.fragment}
    canPushViewState={visible}
    onViewStateChange={(viewState, method) => workspace.updateTarget({ ...tab.target, viewState }, method)}
    onSelectRenderer={(viewer) => workspace.updateTarget({ ...withoutFragment(tab.target), viewer, viewState: null })}
    onMoved={(path) => workspace.retargetCard(tab.target.path, path)}
    onNavigate={(target, hint) => { reportActivity("navigated", target.path); workspace.open(target, { ...hint, originatingPane: pane }); }}
    onAddSelection={onAddSelection} reportActivity={reportActivity} />;
  return <div ref={material} hidden={!visible} {...(!visible ? { inert: "" } : {})} data-workspace-card={tab.target.path} data-active-card={themedSurface || undefined}
    style={{ gridColumn: workspace.mobile || workspace.state.layout.kind === "focus" ? "1 / -1" : pane === "left" ? "1" : "2", gridRow: 1 }}
    className={visible ? "bbx-companion-desk relative flex flex-col min-w-0 min-h-0" : "hidden"}>
    {visible ? <div className="bbx-companion-tabs flex shrink-0 items-stretch min-w-0">
      <SidecarTabStrip id={workspace.mobile ? "bbx-panel-tabs-mobile" : pane === "left" ? "bbx-panel-tabs" : "bbx-panel-tabs-right"} tabs={tabs} activePath={tab.target.path} identities={identities} boxSlug={boxSlug}
        onSelectTab={handleSelectTab} onCloseTab={handleCloseTab} onTogglePin={handleTogglePin} closeLabel={closeLabel} />
      <WorkspaceControls pane={pane} pdfPath={workspacePdf ? tab.target.path : undefined} />
    </div> : null}
    <div role="tabpanel" id={workspacePanelId(tab.target.path)} aria-labelledby={visible ? workspaceTabId(tab.target.path) : undefined} tabIndex={0} aria-hidden={!visible} aria-busy={editing || undefined} data-bbx-scan="exclude"
      data-card-content={themedSurface ? "card" : "neutral"}
      className="bbx-interface-card-desk flex-1 min-h-0 overflow-auto"
      onFocus={() => workspace.activate(tab.target.path)}
      onScroll={(event) => {
        if (!visible) return;
        const node = event.currentTarget;
        reportActivity("scrolled", (node.scrollHeight > node.clientHeight ? Math.round(node.scrollTop / (node.scrollHeight - node.clientHeight) * 10) / 10 : 0).toFixed(1));
      }}>
      {/* A neutral desk is a material the system theme may ink; a card sets its own. */}
      <MaterialContext.Provider value={!themedSurface}><CardVisibilityProvider visible={visible}><WorkspacePaneContext.Provider value={pane}>
        {fileView}
      </WorkspacePaneContext.Provider></CardVisibilityProvider></MaterialContext.Provider>
    </div>
    {/* Always mounted so a screen reader hears the text appear. Out of flow:
        the tab strip measures its row, and a child there would resize it. */}
    {visible ? <span role="status" className="bbx-companion-updating pointer-events-none absolute bottom-3 right-4 rounded-full text-xs" data-editing={editing || undefined}>{editing ? "Updating…" : ""}</span> : null}
  </div>;
}
/**
 * Card roots and the singleton transcript never change React parents on move.
 *
 * `children` (the transcript) is new on every streamed token. The callbacks
 * are destructured by name, never gathered with a rest spread: a rest object
 * is new on every render, so the compiler would rebuild every card element
 * and re-render each open card per token (`components/chat/AGENTS.md`,
 * "Workspace card roots survive presentation changes").
 */
export function WorkspaceCanvas({ children, turnActive, turnTools, onAddSelection, reportActivity }: CardCallbacks & {
  children: ReactNode;
  /** A chat turn is running; with `turnTools`, marks the documents it is editing. */
  turnActive: boolean;
  turnTools: readonly SessionContentBlock[];
}) {
  const workspace = useWorkspace();
  const edited = useTurnEditedPaths({ turnActive, turnTools, openPaths: Object.values(workspace?.state.tabs ?? {}).map((tab) => tab.target.path) });
  const visiblePaths = Object.values(workspace?.projection.visiblePaths ?? {});
  const [visited, setVisited] = useState<Set<string>>(() => new Set(visiblePaths));
  useEffect(() => {
    setVisited((old) => visiblePaths.every((path) => old.has(path)) ? old : new Set([...old, ...visiblePaths]));
  }, [visiblePaths]);
  if (!workspace) return children;
  const { projection, mobile } = workspace;
  const transcript = projection.transcript;
  const split = !mobile && workspace.state.layout.kind === "split" && transcript !== "full";
  return <><VisuallyHidden as="h1">Workspace</VisuallyHidden><div className="grid flex-1 min-h-0 min-w-0" style={{ gridTemplateColumns: split ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr)" }}>
    {Object.values(workspace.state.tabs).map((tab) => {
      const path = tab.target.path;
      if (!visited.has(path) && !visiblePaths.includes(path)) return null;
      const pane = workspace.state.panes.left.paths.includes(path) ? "left" : "right";
      return <WorkspaceCard key={path} tab={tab} pane={pane} visible={workspace.displayReady === true && visiblePaths.includes(path)} editing={edited.has(path)} onAddSelection={onAddSelection} reportActivity={reportActivity} />;
    })}
    <div hidden={!workspace.transcriptVisible} {...(!workspace.transcriptVisible ? { inert: "" } : {})} className={workspace.transcriptVisible ? "bbx-conversation-desk flex flex-col min-h-0 min-w-0 relative" : "hidden"}
      style={{ gridRow: 1, gridColumn: transcript === "right" ? "2" : transcript === "left" ? "1" : "1 / -1" }}>
      <TranscriptFloatingControls restore={projection.restorePane ? <RestoreCardsControl /> : null}>{children}</TranscriptFloatingControls>
    </div>
  </div></>;
}
