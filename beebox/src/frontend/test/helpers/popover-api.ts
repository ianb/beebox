/**
 * The part of the Popover API that happy-dom 20 lacks
 * and `components/ui/Popover.tsx` uses. `showPopover()` on a `<dialog>` runs
 * the dialog focusing steps (HTML Standard, "popover focusing steps"): focus
 * moves to the first focusable descendant, else to the dialog itself. That is
 * the behavior the Popover must undo on a pointer open, so the stand-in keeps
 * it. Whether a popover is showing is read with `popoverOpen(element)`.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const showing = new WeakSet<Element>();

/** Whether `showPopover()` has shown `element` and nothing has hidden it. */
export function popoverOpen(element: Element): boolean {
  return showing.has(element) && element.isConnected;
}

/** A popover call on an element with no `popover` attribute, as the browser throws. */
export class NotAPopoverError extends Error {
  constructor() {
    super("showPopover/hidePopover on an element without a popover attribute");
    this.name = "NotAPopoverError";
  }
}

/** Install the stand-in on the happy-dom window; `dom-globals.ts` calls it after registering the window. */
export function installPopoverApi(): void {
  if ("showPopover" in HTMLElement.prototype) return;
  Object.defineProperties(HTMLElement.prototype, {
    showPopover: {
      configurable: true,
      value(this: HTMLElement): void {
        if (!this.hasAttribute("popover")) throw new NotAPopoverError();
        showing.add(this);
        if (this instanceof HTMLDialogElement) (this.querySelector<HTMLElement>(FOCUSABLE) ?? this).focus();
      },
    },
    hidePopover: {
      configurable: true,
      value(this: HTMLElement): void {
        if (!this.hasAttribute("popover")) throw new NotAPopoverError();
        showing.delete(this);
      },
    },
  });
}
