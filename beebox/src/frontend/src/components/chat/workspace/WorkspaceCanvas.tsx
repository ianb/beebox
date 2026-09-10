import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import { VisuallyHidden } from "../../ui/VisuallyHidden";
import { FileView } from "../../FileView";
import { SidecarTabStrip } from "../SidecarTabStrip";
import { useCompanionMaterial } from "../../../hooks/useCompanionMaterial";
import { useCardIdentities } from "../../../hooks/useCardIdentities";
import { cardTypeFromName } from "@shared/card-name";
import { CardVisibilityProvider } from "../everywhere/card-context";
import { useWorkspace } from "./WorkspaceProvider";
import { WorkspaceControls, RestoreCardsControl } from "./WorkspaceControls";
import { TranscriptFloatingControls } from "./TranscriptFloatingControls";
import { isMarkdownPath } from "../../file-view-data";
import type { SidecarTab } from "../sidecar-tabs";
import type { PaneId } from "./workspace-state";
import type { AddSelectionInput } from "../../../lib/selection/position";
import type { ActivityKind } from "@core/chat/card-activity";

interface CardCallbacks {
  onAddSelection?: (selection: AddSelectionInput) => void;
  reportActivity: (kind: ActivityKind, detail?: string) => void;
}
function WorkspaceCard({ tab, pane, visible, ...callbacks }: CardCallbacks & { tab: SidecarTab; pane: PaneId; visible: boolean }) {
  const workspace = useWorkspace();
  const material = useCompanionMaterial(tab.target.path);
  const { boxSlug } = useParams({ strict: false });
  const tabs = workspace ? workspace.tabsForPane(pane) : [];
  const identities = useCardIdentities(tabs.map((item) => item.target.path));
  if (!workspace) return null;
  const { onSelectTab: handleSelectTab, onCloseTab: handleCloseTab, onTogglePin: handleTogglePin } = workspace;
  const handleAddSelection = callbacks.onAddSelection;
  const themedSurface = cardTypeFromName(tab.target.path) !== undefined || isMarkdownPath(tab.target.path);
  return <div ref={material} hidden={!visible} {...(!visible ? { inert: "" } : {})} data-workspace-card={tab.target.path} data-active-card={themedSurface || undefined}
    style={{ gridColumn: workspace.mobile || workspace.state.layout.kind === "focus" ? "1 / -1" : pane === "left" ? "1" : "2", gridRow: 1 }}
    className={visible ? "bbx-companion-desk flex flex-col min-w-0 min-h-0" : "hidden"}>
    {visible ? <div className="bbx-companion-tabs flex shrink-0 items-stretch min-w-0">
      <SidecarTabStrip id={workspace.mobile ? "bbx-panel-tabs-mobile" : pane === "left" ? "bbx-panel-tabs" : "bbx-panel-tabs-right"} tabs={tabs} activePath={tab.target.path} identities={identities} boxSlug={boxSlug}
        onSelectTab={handleSelectTab} onCloseTab={handleCloseTab} onTogglePin={handleTogglePin} />
      <WorkspaceControls pane={pane} />
    </div> : null}
    <div role="tabpanel" id={`bbx-workspace-panel-${encodeURIComponent(tab.target.path)}`} aria-labelledby={visible ? `bbx-workspace-tab-${encodeURIComponent(tab.target.path)}` : undefined} tabIndex={0} aria-hidden={!visible} data-bbx-scan="exclude"
      data-card-content={themedSurface ? "card" : "neutral"}
      className="bbx-interface-card-desk flex-1 min-h-0 overflow-auto"
      onFocus={() => workspace.activate(tab.target.path)}
      onScroll={(event) => {
        if (!visible) return;
        const node = event.currentTarget;
        callbacks.reportActivity("scrolled", (node.scrollHeight > node.clientHeight ? Math.round(node.scrollTop / (node.scrollHeight - node.clientHeight) * 10) / 10 : 0).toFixed(1));
      }}>
      <CardVisibilityProvider visible={visible}>
        <FileView path={tab.target.path} mode="companion" rendererName={tab.target.viewer} params={tab.target.params} viewState={tab.target.viewState}
          canPushViewState={visible}
          onViewStateChange={(viewState, method) => workspace.updateTarget({ ...tab.target, viewState }, method)}
          onSelectRenderer={(viewer) => workspace.updateTarget({ ...tab.target, viewer, viewState: null })}
          onNavigate={(target, hint) => { callbacks.reportActivity("navigated", target.path); workspace.open(target, { ...hint, originatingPane: pane }); }}
          onAddSelection={handleAddSelection} reportActivity={callbacks.reportActivity} />
      </CardVisibilityProvider>
    </div>
  </div>;
}
/** Card roots and the singleton transcript never change React parents on move. */
export function WorkspaceCanvas({ children, routeContent, ...callbacks }: CardCallbacks & { children: ReactNode; routeContent?: ReactNode }) {
  const workspace = useWorkspace();
  const visiblePaths = Object.values(workspace?.projection.visiblePaths ?? {});
  const [visited, setVisited] = useState<Set<string>>(() => new Set(visiblePaths));
  useEffect(() => {
    setVisited((old) => visiblePaths.every((path) => old.has(path)) ? old : new Set([...old, ...visiblePaths]));
  }, [visiblePaths]);
  if (!workspace) return children;
  const { projection, participating, mobile } = workspace;
  const transcript = participating ? projection.transcript : "full";
  const split = participating && !mobile && workspace.state.layout.kind === "split" && transcript !== "full";
  return <><VisuallyHidden as="h1">Workspace</VisuallyHidden><div className="grid flex-1 min-h-0 min-w-0" style={{ gridTemplateColumns: split ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr)" }}>
    {!participating && routeContent !== undefined ? <div hidden={workspace.transcriptVisible} className={workspace.transcriptVisible ? "hidden" : "min-w-0 min-h-0 overflow-auto"} style={{ gridArea: "1 / 1" }}>{routeContent}</div> : null}
    {Object.values(workspace.state.tabs).map((tab) => {
      const path = tab.target.path;
      if (!visited.has(path) && !visiblePaths.includes(path)) return null;
      const pane = workspace.state.panes.left.paths.includes(path) ? "left" : "right";
      return <WorkspaceCard key={path} tab={tab} pane={pane} visible={workspace.displayReady === true && participating === true && visiblePaths.includes(path)} {...callbacks} />;
    })}
    <div hidden={!workspace.transcriptVisible} {...(!workspace.transcriptVisible ? { inert: "" } : {})} className={workspace.transcriptVisible ? "flex flex-col min-h-0 min-w-0 relative" : "hidden"}
      style={{ gridRow: 1, gridColumn: transcript === "right" ? "2" : transcript === "left" ? "1" : "1 / -1", background: "var(--bbx-desk-background)" }}>
      <TranscriptFloatingControls restore={participating && projection.restorePane ? <RestoreCardsControl /> : null}>{children}</TranscriptFloatingControls>
    </div>
  </div></>;
}
