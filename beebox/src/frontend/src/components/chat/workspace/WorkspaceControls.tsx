import { Button } from "../../ui/Button";
import { useWorkspace } from "./WorkspaceProvider";
import type { PaneId } from "./workspace-state";

function ControlIcon({ path }: { path: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}
export function WorkspaceControls({ pane }: { pane: PaneId }) {
  const workspace = useWorkspace();
  if (!workspace) return null;
  const { state, mobile, dispatch } = workspace;
  const viewport = mobile ? "mobile" : "desktop";
  return <div className="flex shrink-0 items-center gap-1 px-2" aria-label="Pane controls">
    {!mobile && state.layout.kind === "focus" ?
      <Button id={`bbx-pane-${pane}-unfocus`} intent="ghost" size="sm" label="Back to split" icon={<ControlIcon path="M3 4h18v16H3zM12 4v16" />} onClick={() => dispatch({ type: "backToSplit", pane })} /> : <>
        {!mobile ? <>
          <Button id={`bbx-pane-${pane}-move`} intent="ghost" size="sm" label={`Move ${pane === "left" ? "right" : "left"}`} icon={<ControlIcon path={pane === "left" ? "M4 12h16m-6-6 6 6-6 6" : "M20 12H4m6-6-6 6 6 6"} />} onClick={() => dispatch({ type: "moveActive", pane })} />
          <Button id={`bbx-pane-${pane}-focus`} intent="ghost" size="sm" label="Focus card" icon={<ControlIcon path="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />} onClick={() => dispatch({ type: "focusPane", pane })} />
        </> : null}
        <Button id={`bbx-pane-${pane}-chat`} intent="ghost" size="sm" label="Show conversation" icon={<ControlIcon path="M4 4h16v12H9l-5 4z" />} onClick={() => dispatch({ type: "showChat", pane, viewport })} />
      </>}
  </div>;
}
export function RestoreCardsControl() {
  const workspace = useWorkspace();
  if (!workspace?.projection.restorePane) return null;
  const pane = workspace.projection.restorePane;
  return <Button id="bbx-workspace-show-cards" intent="secondary" shape="circle" size="sm" label={`Show cards (${workspace.state.panes[pane].paths.length})`} icon={<ControlIcon path="M7 3h13v15H7zM4 7H2v15h13v-2" />} onClick={() => workspace.restoreCards(pane)} />;
}
