import { useEffect, useRef, type ReactNode } from "react";
import { useModalDialog } from "../../hooks/useModalDialog";
import { cn } from "../../lib/cn";

export type ModalCardTone = "light" | "dark";

export interface ModalCardProps {
  children: ReactNode;
  /** Renders nothing while false; opening shows a native modal `<dialog>`. */
  open: boolean;
  /** Id of the heading that names the dialog. */
  labelledBy: string;
  /** `dark` for a dialog over the dark capture screen. */
  tone?: ModalCardTone;
  /**
   * Escape (the native `cancel` event). The default close is always
   * prevented; the caller decides whether to close. Omit it and Escape does
   * nothing.
   */
  onCancel?: () => void;
  /** A press on the dimmed page around the card. Omit it and the press does nothing. */
  onBackdropClick?: () => void;
  /** Selector of the element to focus on open, in place of the browser's first control. */
  initialFocus?: string;
  /** DOM id of the `<dialog>`. */
  id?: string;
  /** Outer-layout classes (margin, sizing, position). */
  className?: string;
}

const TONE_CLASSES: Record<ModalCardTone, string> = {
  light: "bg-white text-warm-900",
  dark: "border border-gray-700 bg-gray-900 text-white",
};

/**
 * The card of a modal dialog: a native `<dialog>` opened with `showModal()`,
 * so focus stays inside, the page behind is inert, and focus returns to the
 * opener on close (`useModalDialog`). Callers supply the heading, body and
 * action row. The padding sits on an inner box, so a press whose target is
 * the `<dialog>` itself landed on the backdrop. The backdrop press is a
 * pointer shortcut for Escape, so it is a listener rather than a control.
 */
export function ModalCard({ children, open, labelledBy, tone, onCancel, onBackdropClick, initialFocus, id, className }: ModalCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog({ dialog: dialogRef, open, ...(initialFocus === undefined ? {} : { initialFocus }) });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null || onBackdropClick === undefined) return;
    const onPress = (event: MouseEvent): void => {
      if (event.target === dialog) onBackdropClick();
    };
    dialog.addEventListener("mousedown", onPress);
    return () => dialog.removeEventListener("mousedown", onPress);
  }, [open, onBackdropClick]);
  if (!open) return null;
  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        "m-auto max-h-[calc(100%-3rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg p-0 shadow-xl backdrop:bg-black/60",
        TONE_CLASSES[tone ?? "light"],
        className,
      )}
      onCancel={(event) => {
        event.preventDefault();
        onCancel?.();
      }}
      onClose={(event) => {
        // A close this component did not ask for. Chrome stops honoring
        // preventDefault on a repeated Escape with no click in between and
        // closes the dialog itself. Treat that as Escape, then reopen if the
        // caller kept the dialog (no onCancel, or it ignored the Escape).
        // When the caller closes it, the <dialog> is already detached; when
        // the effect reopens it, it is open again.
        const dialog = event.currentTarget;
        if (!dialog.isConnected || dialog.open) return;
        onCancel?.();
        setTimeout(() => {
          if (dialog.isConnected && !dialog.open) dialog.showModal();
        }, 0);
      }}
    >
      <div className="p-5">{children}</div>
    </dialog>
  );
}
