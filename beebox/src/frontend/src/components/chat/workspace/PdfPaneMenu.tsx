import { apiRawFileUrl, getApiBase } from "../../../api";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
import { MenuItem } from "../../ui/dropdown-menu-item";
import type { PaneId } from "./workspace-state";

export function PdfPaneMenu({ path, pane }: { path: string; pane: PaneId }) {
  const src = apiRawFileUrl(getApiBase(), path);
  const filename = path.split("/").pop() ?? path;
  return <Dropdown trigger={({ toggle, ariaProps }) => <Button
    id={`bbx-pane-${pane}-pdf-actions`} intent="ghost" size="sm" label="PDF actions" onClick={toggle} {...ariaProps}
    icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>}
  />}>
    <MenuItem id={`bbx-pane-${pane}-pdf-download`} href={src} download={filename}>Download PDF</MenuItem>
    <MenuItem id={`bbx-pane-${pane}-pdf-open`} href={src} target="_blank">Open PDF in new tab</MenuItem>
  </Dropdown>;
}
