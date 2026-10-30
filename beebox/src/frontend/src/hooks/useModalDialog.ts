/**
 * Show a native `<dialog>` as a modal while `open`. showModal() puts it in the
 * top layer and makes the page behind it inert (the focus trap); closing
 * returns focus to whatever had it before. `initialFocus` names an element
 * inside the dialog to focus instead of the browser's first control.
 */

import { useEffect, type RefObject } from "react";

export function useModalDialog({ dialog: dialogRef, open, initialFocus }: {
  dialog: RefObject<HTMLDialogElement | null>;
  open: boolean;
  initialFocus?: string;
}): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) return;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    if (initialFocus !== undefined) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      if (dialog.open) dialog.close();
      priorFocus?.focus();
    };
  }, [dialogRef, open, initialFocus]);
}
