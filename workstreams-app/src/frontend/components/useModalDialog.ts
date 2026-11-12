import { useEffect, useRef, type RefObject } from "react";

/**
 * A native modal dialog opened while `open` is true: Escape, focus containment
 * and an inert page behind it come from the platform. The caller renders the
 * `<dialog>` with the returned ref and unmounts it from its `onClose`. Light
 * dismiss (click outside) is on; React 18's typings lack `closedby`, so it is
 * set on the element.
 *
 * Close through `ref.current.close()`, not by unmounting: closing returns focus
 * to the invoker, and unmounting an open dialog skips that.
 */
export function useModalDialog(open: boolean): RefObject<HTMLDialogElement> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null || dialog.open) return;
    dialog.setAttribute("closedby", "any");
    dialog.showModal();
  }, [open]);
  return dialogRef;
}
