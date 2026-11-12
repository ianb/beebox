import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useModalDialog } from "../../hooks/useModalDialog";
import { cn } from "../../lib/cn";

export type ModalDialogTone = "light" | "dark" | "clear";

export type ModalDialogLayout = "card" | "fullscreen";

/** The dialog's name: the id of a visible heading, or a text label when there is none. */
export type ModalDialogName = { labelledBy: string; label?: never } | { label: string; labelledBy?: never };

export type ModalDialogProps = ModalDialogName & {
  children: ReactNode;
  /** Renders nothing while false; opening shows a native modal `<dialog>`. */
  open: boolean;
  /**
   * `card` (default): a padded card over a dimmed page. `fullscreen`: the
   * whole viewport with no padding; the children draw everything.
   */
  layout?: ModalDialogLayout;
  /**
   * `dark` for a dialog over the dark capture screen; `clear` is transparent
   * with no dimming, for a fullscreen dialog that paints its own backdrop
   * (the image lightbox).
   */
  tone?: ModalDialogTone;
  /**
   * Inline placement for a fullscreen dialog: a visual-viewport rect
   * (`top`, `left`, `width`, `height`) so it stays above the iOS keyboard.
   */
  style?: Pick<CSSProperties, "top" | "left" | "width" | "height">;
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
};

const TONE_CLASSES: Record<ModalDialogTone, string> = {
  light: "bg-white text-warm-900 backdrop:bg-black/60",
  dark: "border border-gray-700 bg-gray-900 text-white backdrop:bg-black/60",
  clear: "bg-transparent backdrop:bg-transparent",
};

const LAYOUT_CLASSES: Record<ModalDialogLayout, string> = {
  card: "m-auto max-h-[calc(100%-3rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg p-0 shadow-xl",
  fullscreen: "fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 p-0",
};

/**
 * The card of a modal dialog: a native `<dialog>` opened with `showModal()`,
 * so focus stays inside, the page behind is inert, and focus returns to the
 * opener on close (`useModalDialog`). Callers supply the heading, body and
 * action row. The padding sits on an inner box, so a press whose target is
 * the `<dialog>` itself landed on the backdrop. The backdrop press is a
 * pointer shortcut for Escape, so it is a listener rather than a control.
 * A fullscreen dialog has no backdrop to press: its children fill it.
 */
export function ModalDialog({ children, open, labelledBy, label, layout, tone, style, onCancel, onBackdropClick, initialFocus, id, className }: ModalDialogProps) {
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
      aria-label={label}
      className={cn(LAYOUT_CLASSES[layout ?? "card"], TONE_CLASSES[tone ?? "light"], className)}
      style={style}
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
      {layout === "fullscreen" ? children : <div className="p-5">{children}</div>}
    </dialog>
  );
}
