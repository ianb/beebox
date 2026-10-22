import { Button } from "../../../ui/Button";
import { useWorkspace } from "../WorkspaceProvider/provider";
import type { PaneId } from "../state-types.js";
import { PdfPaneMenu } from "./PdfPaneMenu";
import { ControlIcon, PaneControls } from "../PaneControls";

export function WorkspaceControls({ pane, pdfPath }: { pane: PaneId; pdfPath?: string }) {
  const workspace = useWorkspace();
  if (!workspace) return null;
  const { state, mobile, dispatch } = workspace;
  const viewport = mobile ? "mobile" : "desktop";
  return <PaneControls pane={pane} mobile={mobile} focused={state.layout.kind === "focus"}
    pdfMenu={pdfPath ? <PdfPaneMenu key={pdfPath} path={pdfPath} pane={pane} /> : null}
    onAction={(action) => dispatch(action === "showChat" ? { type: action, pane, viewport } : { type: action, pane })} />;
}

export function RestoreCardsControl() {
  const workspace = useWorkspace();
  if (!workspace?.projection.restorePane) return null;
  const pane = workspace.projection.restorePane;
  return <Button id="bbx-workspace-show-cards" intent="secondary" shape="circle" size="sm" label={`Restore cards (${workspace.state.panes[pane].paths.length})`} icon={<ControlIcon path="M7 3h13v15H7zM4 7H2v15h13v-2" />} onClick={() => workspace.restoreCards(pane)} />;
}
