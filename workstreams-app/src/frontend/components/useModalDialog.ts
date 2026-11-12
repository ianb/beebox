import { useEffect, useRef, type RefObject } from "react";
import { showNativeModal } from "../../../../beebox/src/frontend/src/lib/native-modal.js";

/**
 * A native modal dialog shown while `open` is true, with beebox's lifecycle
 * (`lib/native-modal`): it closes on `open` → false and on unmount, and focus
 * goes back where it was. Escape, focus containment and an inert page behind
 * it come from the platform. The caller renders the `<dialog>` with the
 * returned ref and unmounts it from its `onClose`. Light dismiss (click
 * outside) is on; React 18's typings lack `closedby`, so it is set on the
 * element.
 */
export function useModalDialog(open: boolean): RefObject<HTMLDialogElement> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) return;
    dialog.setAttribute("closedby", "any");
    return showNativeModal(dialog);
  }, [open]);
  return dialogRef;
}
