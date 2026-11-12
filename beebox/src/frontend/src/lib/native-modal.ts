/**
 * The native modal lifecycle shared by beebox's `hooks/useModalDialog` and the
 * dev dashboard's (`workstreams-app/src/frontend/components/useModalDialog.ts`):
 * show a `<dialog>` as a modal, and return the cleanup that closes it and puts
 * focus back where it was. Call it from an effect keyed on `open` and return
 * the cleanup, so the dialog closes both on `open` → false and on unmount.
 *
 * Plain DOM with no imports, so another package's build can take it without
 * beebox's app effects (toast hold, Escape layers), which stay in its hook.
 */
export function showNativeModal(dialog: HTMLDialogElement): () => void {
  const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!dialog.open) dialog.showModal();
  return () => {
    if (dialog.open) dialog.close();
    priorFocus?.focus();
  };
}
