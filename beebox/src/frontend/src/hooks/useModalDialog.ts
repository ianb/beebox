/**
 * Show a native `<dialog>` as a modal while `open` (`lib/native-modal`).
 * showModal() puts it in the top layer and makes the page behind it inert (the
 * focus trap); closing returns focus to whatever had it before. `initialFocus` names an element
 * inside the dialog to focus instead of the browser's first control. While
 * open it holds toast expiry, since the modal covers the toasts, and it is the
 * newest Escape layer (`lib/escape-layers`), so a menu or popover opened
 * before it leaves Escape to the modal's `cancel`.
 *
 * Only `components/ui/ModalDialog.tsx` imports this (lint-enforced).
 */

import { useEffect, type RefObject } from "react";
import { acquireHold } from "../components/ui/toast-store";
import { pushEscapeLayer } from "../lib/escape-layers";
import { showNativeModal } from "../lib/native-modal";

export function useModalDialog({ dialog: dialogRef, open, initialFocus }: {
  dialog: RefObject<HTMLDialogElement | null>;
  open: boolean;
  initialFocus?: string;
}): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) return;
    const closeModal = showNativeModal(dialog);
    const releaseHold = acquireHold();
    const escapeLayer = pushEscapeLayer();
    if (initialFocus !== undefined) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      releaseHold();
      escapeLayer.release();
      closeModal();
    };
  }, [dialogRef, open, initialFocus]);
}
