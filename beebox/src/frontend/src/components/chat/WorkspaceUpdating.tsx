/** The workspace editing status sits beside the card panel, outside its material. */
export function WorkspaceUpdating({ editing }: { editing: boolean }) {
  return <span role="status" className="bbx-companion-updating pointer-events-none absolute bottom-3 right-4 rounded-full text-xs" data-editing={editing || undefined}>{editing ? "Updating…" : ""}</span>;
}
