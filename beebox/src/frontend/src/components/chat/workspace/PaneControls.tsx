import type { ReactNode } from "react";
import { Button } from "../../ui/Button";
import type { PaneId } from "./state-types.js";

export function ControlIcon({ path }: { path: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

/** The pane's buttons as drawn; the theme studio renders them with no workspace. */
export function PaneControls({ pane, mobile, focused, pdfMenu, onAction }: {
  pane: PaneId;
  mobile: boolean;
  focused: boolean;
  pdfMenu: ReactNode;
  onAction: (action: "backToSplit" | "moveActive" | "focusPane" | "showChat") => void;
}) {
  return <div className="flex shrink-0 items-center gap-1 px-2" aria-label="Pane controls">
    {pdfMenu}
    {!mobile && focused ?
      <Button id={`bbx-pane-${pane}-unfocus`} intent="ghost" size="sm" label="Back to split" icon={<ControlIcon path="M3 4h18v16H3zM12 4v16" />} onClick={() => onAction("backToSplit")} /> : <>
        {!mobile ? <>
          <Button id={`bbx-pane-${pane}-move`} intent="ghost" size="sm" label={`Move ${pane === "left" ? "right" : "left"}`} icon={<ControlIcon path={pane === "left" ? "M4 12h16m-6-6 6 6-6 6" : "M20 12H4m6-6-6 6 6 6"} />} onClick={() => onAction("moveActive")} />
          <Button id={`bbx-pane-${pane}-focus`} intent="ghost" size="sm" label="Focus card" icon={<ControlIcon path="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />} onClick={() => onAction("focusPane")} />
        </> : null}
        <Button id={`bbx-pane-${pane}-chat`} intent="ghost" size="sm" label="Minimize cards" icon={<ControlIcon path="M5 12h14" />} onClick={() => onAction("showChat")} />
      </>}
  </div>;
}
