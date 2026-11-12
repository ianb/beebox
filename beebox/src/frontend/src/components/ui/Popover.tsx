/**
 * Popover — a non-modal panel anchored to its trigger: a native
 * `<dialog popover="manual">` rendered right after the trigger and shown with
 * `showPopover()`, so it is drawn in the top layer (no z-index, never clipped
 * by an `overflow` ancestor) while it stays in DOM order after its trigger.
 * Inside a `ModalDialog` it is therefore the modal's descendant and stays
 * interactive.
 *
 * Interaction contract (docs/plans/ui-primitives-dedup.md, Track 7):
 * 1. A press on the trigger toggles; Enter or Space opens. The trigger
 *    carries `aria-haspopup`, `aria-expanded` and, while open, `aria-controls`.
 * 2. A keyboard open focuses the first focusable element in the panel, or the
 *    panel. A pointer open leaves focus on the trigger: `showPopover()` on a
 *    `<dialog>` runs the dialog focusing steps, so focus is put back.
 * 3. Focus is not trapped. Tab and Shift+Tab move through the page in DOM
 *    order; focus leaving both the trigger and the panel (`focusout` with an
 *    outside `relatedTarget`) closes it.
 * 4. Escape closes and returns focus to the trigger.
 * 5. A press outside closes; focus returns to the trigger only when it was in
 *    the panel.
 * 6. `label` names the panel.
 * `manual` has no light dismiss of its own; `AnchoredLayer` places and
 * dismisses it.
 */

import { useCallback, useId, useRef, useState, type FocusEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useIsomorphicLayoutEffect } from "../../hooks/use-isomorphic-layout-effect";
import { useAnchoredLayer, type AnchorAlign, type AnchorVertical, type LayerDismissReason } from "./AnchoredLayer";

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type PopoverWidth = "md" | "lg";

const WIDTH_CLASSES: Record<PopoverWidth, string> = { md: "w-64", lg: "w-96" };

export interface PopoverTriggerProps {
  open: boolean;
  /** Wire into the trigger's `onClick` directly: the event tells a keyboard open (`detail === 0`) from a pointer one. */
  toggle: (event?: ReactMouseEvent<HTMLElement>) => void;
  /** Spread on the trigger. */
  ariaProps: { "aria-haspopup": "dialog"; "aria-expanded": boolean; "aria-controls"?: string };
}

export interface PopoverProps {
  /** Render prop for the trigger; wire `toggle` to `onClick` and spread `ariaProps`. */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  /** Names the panel. */
  label: string;
  /** The panel's content; a function receives `close` (focus goes back to the trigger). */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Panel edge aligned to the trigger. Default `"left"`. */
  align?: AnchorAlign;
  /** Preferred side; the panel flips when the other side has more room. Default `"below"`. */
  vertical?: AnchorVertical;
  /** `md` 16rem (default), `lg` 24rem. */
  width?: PopoverWidth;
}

function firstTriggerElement(root: HTMLElement | null): HTMLElement | null {
  const first = root?.firstElementChild;
  return first instanceof HTMLElement ? first : null;
}

/** Show the panel and settle focus per rule 2. */
function useShowPanel({ open, panelRef, triggerRef, keyboardOpenRef }: {
  open: boolean;
  panelRef: React.RefObject<HTMLDialogElement>;
  triggerRef: React.RefObject<HTMLElement | null>;
  keyboardOpenRef: React.RefObject<boolean>;
}): void {
  // Declared before useAnchoredLayer: the panel must be showing to be measured.
  useIsomorphicLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || panel === null) return;
    panel.popover = "manual";
    panel.showPopover();
    if (keyboardOpenRef.current === true) {
      (panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel).focus({ preventScroll: true });
    } else {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open, panelRef, triggerRef, keyboardOpenRef]);
}

/** Calls a render prop as a child component, so its callbacks are not read during the Popover's own render. */
function Slot<T>({ render, value }: { render: (value: T) => ReactNode; value: T }): ReactNode {
  return render(value);
}

export function Popover({ trigger, label, children, align, vertical, width }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const keyboardOpenRef = useRef(false);
  const panelId = useId();

  const close = useCallback((restoreFocus: boolean) => {
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
  }, []);
  const closeAndRestore = useCallback(() => close(true), [close]);
  const onDismiss = useCallback((reason: LayerDismissReason) => {
    const active = document.activeElement;
    const inPanel = active !== null && panelRef.current?.contains(active) === true;
    close(reason === "escape" || inPanel);
  }, [close]);

  useShowPanel({ open, panelRef, triggerRef, keyboardOpenRef });
  const style = useAnchoredLayer({
    open,
    anchor: { trigger: triggerRef },
    layer: panelRef,
    align: align ?? "left",
    vertical: vertical ?? "below",
    onDismiss,
  });

  const toggle = useCallback((event?: ReactMouseEvent<HTMLElement>) => {
    triggerRef.current = event?.currentTarget ?? firstTriggerElement(rootRef.current);
    keyboardOpenRef.current = event !== undefined && event.detail === 0;
    setOpen((o) => !o);
  }, []);

  // Rule 3: leaving both the trigger and the panel closes it.
  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    const next = event.relatedTarget;
    if (open && next instanceof Node && rootRef.current?.contains(next) !== true) setOpen(false);
  };

  const triggerProps: PopoverTriggerProps = {
    open,
    toggle,
    ariaProps: { "aria-haspopup": "dialog", "aria-expanded": open, ...(open ? { "aria-controls": panelId } : {}) },
  };

  return (
    <span ref={rootRef} className="contents" onBlur={onBlur}>
      <Slot render={trigger} value={triggerProps} />
      {open ? (
        <dialog
          ref={panelRef}
          id={panelId}
          aria-label={label}
          tabIndex={-1}
          // The top layer's UA style centers a popover (`inset: 0; margin: auto`); the anchored style replaces it.
          style={{ ...style, right: "auto", bottom: "auto", margin: 0 }}
          className={cn(
            // The panel stays in its trigger's DOM subtree, so it resets the text styles it would inherit (a badge row's caps).
            "bg-white text-warm-800 rounded-lg shadow-lg border border-warm-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-left overflow-y-auto overscroll-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            WIDTH_CLASSES[width ?? "md"],
          )}
        >
          {typeof children === "function" ? <Slot render={children} value={closeAndRestore} /> : children}
        </dialog>
      ) : null}
    </span>
  );
}
