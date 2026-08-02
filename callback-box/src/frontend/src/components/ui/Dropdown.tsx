import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";

// The "first focusable menu item" the open/close focus management below
// looks for. Deliberately broader than `[role="menuitem"]`: several existing
// menus nest plain focusable controls (e.g. `RecentFilesPanel`'s per-row
// preview/panel buttons, `LandmarkLinksPanel`'s group-expand toggles) that
// aren't `MenuItem`s themselves but are still real, reachable menu content.
const FOCUSABLE_MENU_ITEM_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DropdownContextValue {
  close: () => void;
  /** Tighter padding for menu items + dividers. */
  dense: boolean;
}

/** Exported for `MenuItem`/`MenuDivider` (`dropdown-menu-item.tsx`) only. */
export const DropdownContext = createContext<DropdownContextValue | null>(null);

/** Close the enclosing Dropdown. No-op outside one. For custom menu content. */
export function useDropdownClose(): () => void {
  const ctx = useContext(DropdownContext);
  return ctx !== null ? ctx.close : () => {};
}

export type DropdownAlign = "left" | "right";
export type DropdownVertical = "below" | "above";

export interface DropdownTriggerProps {
  open: boolean;
  /**
   * Wire into your trigger element's `onClick` (pass the reference directly,
   * e.g. `onClick={toggle}`) — the click event is used to detect a
   * keyboard-activated open (`event.detail === 0`) and to record the trigger
   * element for focus restoration on close.
   */
  toggle: (event?: ReactMouseEvent<HTMLElement>) => void;
  /** Props to spread on your trigger element for correct ARIA. */
  ariaProps: { "aria-haspopup": "menu"; "aria-expanded": boolean };
}

export interface DropdownProps {
  /**
   * Render prop that produces the trigger. Wire `toggle` into your
   * element's `onClick` and spread `ariaProps` for accessibility.
   */
  trigger: (props: DropdownTriggerProps) => ReactNode;
  children: ReactNode;
  /** Menu edge aligned to the trigger. Default `"right"`. */
  align?: DropdownAlign;
  /** Whether the menu opens below or above the trigger. Default `"below"`. */
  vertical?: DropdownVertical;
  /** Tailwind width class for the menu. Default `"w-48"`. */
  width?: string;
  /** Tighter padding for menu items + dividers. */
  dense?: boolean;
  /** Outer-layout classes for the relative-positioned wrapper (margin, padding, flex item, sizing, position). */
  className?: string;
  /** Called whenever the menu transitions from open to closed. Use to reset
   *  per-open ephemeral state (e.g. submenu page). */
  onClose?: () => void;
  /**
   * Sub-panel depth for the panel-swap idiom (0 = root, 1+ = nested panels).
   * When this changes while open, the content wrapper remounts (keyed on the
   * value) and slides in — from the right on a deeper panel, from the left
   * on a shallower one. Omit for menus with no sub-panels (no animation).
   */
  panelIndex?: number;
}

// The open-state half of the minimal focus management (full arrow-key roving
// focus is out of scope). Two concerns, both scoped to an open menu:
//
// 1. Focus the first menu item when the menu opens via a keyboard activation
//    of the trigger (a keyboard-activated click has `event.detail === 0`).
//    Mouse opens leave focus untouched so no focus ring appears. Some menus
//    (e.g. `SessionListPanel`) mount a loading row before their real content,
//    so a plain post-mount check can miss the first item entirely — a
//    one-shot MutationObserver picks it up whenever it actually appears.
// 2. A `keepOpen` submenu row (the panel-swap idiom) unmounts the focused
//    element when the panel changes, dropping focus to <body> — after which
//    Escape can't restore the trigger (focus is no longer inside the menu)
//    and a keyboard user loses their place entirely. Watch for DOM changes
//    that strand focus on <body> and re-anchor it on the first focusable item
//    of the new panel. Menu items carry no :focus ring styling, so a
//    mouse-driven swap doesn't acquire a visible ring from this.
function useOpenMenuFocus({ open, menuRef, keyboardOpenRef }: {
  open: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  keyboardOpenRef: React.RefObject<boolean>;
}) {
  useEffect(() => {
    if (!open || !keyboardOpenRef.current) return;
    const menu = menuRef.current;
    if (menu === null) return;
    const focusFirst = (): boolean => {
      const first = menu.querySelector<HTMLElement>(FOCUSABLE_MENU_ITEM_SELECTOR);
      if (first === null) return false;
      first.focus();
      return true;
    };
    if (focusFirst()) return;
    const observer = new MutationObserver(() => {
      if (focusFirst()) observer.disconnect();
    });
    observer.observe(menu, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, menuRef, keyboardOpenRef]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (menu === null) return;
    const observer = new MutationObserver(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      const first = menu.querySelector<HTMLElement>(FOCUSABLE_MENU_ITEM_SELECTOR);
      first?.focus();
    });
    observer.observe(menu, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, menuRef]);
}

// Direction for the panel-swap slide: the "adjust state during render"
// pattern (react.dev "You Might Not Need an Effect") rather than an effect,
// so the very first render after a `panelIndex` change already picks the
// right class — an effect would land one render late. Calling `setState`
// here is safe because it's conditioned on an actual change, so it can't
// loop. The result is null until a panel swap happens WITHIN the current
// open session: opening the menu itself must not slide (and must not reuse
// the direction left over from a previous session — the onClose reset back
// to the root panel records a spurious "left" that would otherwise play on
// the next open), so each closed→open transition clears it.
function usePanelSlideDirection({ open, panelIndex }: { open: boolean; panelIndex: number }): "right" | "left" | null {
  const [prevPanelIndex, setPrevPanelIndex] = useState(panelIndex);
  const [direction, setDirection] = useState<"right" | "left" | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDirection(null);
  }
  if (panelIndex !== prevPanelIndex) {
    setDirection(open ? (panelIndex > prevPanelIndex ? "right" : "left") : null);
    setPrevPanelIndex(panelIndex);
  }
  return direction;
}

export function Dropdown({ trigger, children, align: alignArg, vertical: verticalArg, width: widthArg, dense: denseArg, className, onClose, panelIndex }: DropdownProps) {
  const align = alignArg ?? "right";
  const vertical = verticalArg ?? "below";
  const width = widthArg ?? "w-48";
  const dense = denseArg ?? false;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Minimal focus management (full arrow-key roving focus is out of scope):
  // remember the element that opened the menu so close can restore focus to
  // it, whether the open was via keyboard (focus the first item) or mouse
  // (leave focus alone, no visible focus ring).
  const triggerElRef = useRef<HTMLElement | null>(null);
  const keyboardOpenRef = useRef(false);
  const restoreFocusRef = useRef(false);

  // Fire onClose + restore focus on the open→closed transition.
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      const cb = onCloseRef.current;
      if (cb) cb();
      if (restoreFocusRef.current) triggerElRef.current?.focus();
      restoreFocusRef.current = false;
    }
    prevOpenRef.current = open;
  }, [open]);

  useOpenMenuFocus({ open, menuRef, keyboardOpenRef });

  // Closes the menu, first recording whether focus should be restored to the
  // trigger: only when focus is currently inside the menu. A click-outside
  // that leaves focus elsewhere (e.g. the user tabbed to or clicked another
  // control before dismissing the menu) does not yank focus back.
  const closeMenu = useCallback(() => {
    const active = document.activeElement;
    const menu = menuRef.current;
    restoreFocusRef.current = menu !== null && active !== null && menu.contains(active);
    setOpen(false);
  }, []);

  // The menu is portaled to document.body so it escapes any `overflow-hidden`
  // / clipping ancestor (e.g. chat message bubbles). Because it's no longer in
  // normal flow, it's positioned `fixed` from the trigger's viewport rect and
  // repositioned on scroll/resize. The final box is clamped into the viewport
  // (with an 8px margin) so a menu wider or taller than the room beside/below
  // its trigger stays fully on-screen rather than clipping off an edge — a menu
  // near the right edge no longer runs off the left, and a long menu scrolls
  // in place instead of overflowing the bottom.
  const [coords, setCoords] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || rootRef.current === null) return;
    const update = () => {
      const root = rootRef.current;
      if (root === null) return;
      const rect = root.getBoundingClientRect();
      const gap = 4;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const next: CSSProperties = { position: "fixed", maxWidth: vw - margin * 2 };
      // Vertical: anchor the near edge to the trigger, then bound the far edge
      // to the viewport so a tall menu gains a scrollbar instead of overflowing.
      if (vertical === "above") {
        next.bottom = vh - rect.top + gap;
        next.maxHeight = rect.top - gap - margin;
      } else {
        next.top = rect.bottom + gap;
        next.maxHeight = vh - (rect.bottom + gap) - margin;
      }
      // Horizontal: align to the trigger per `align`, then clamp the whole box
      // within [margin, vw - margin]. `right-0`-style alignment measured only
      // the trigger's x, so a wide menu beside a mid-header trigger slid off the
      // left edge; clamping the computed left keeps it on-screen either way.
      const menu = menuRef.current;
      const rawWidth = menu ? menu.getBoundingClientRect().width : 0;
      const effWidth = Math.min(rawWidth, vw - margin * 2);
      const anchored = align === "right" ? rect.right - effWidth : rect.left;
      next.left = Math.max(margin, Math.min(anchored, vw - margin - effWidth));
      setCoords(next);
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    // A width-class swap (e.g. ChatMenu's Recent-chats panel) now eases via
    // CSS `transition-[width]` rather than snapping, so the menu's measured
    // width changes continuously over ~150ms — a one-shot `update()` at the
    // start of the swap would clamp `left` against the *old* width and drift
    // out of sync as the box animates. A ResizeObserver on the menu element
    // re-runs the clamp on every intermediate frame so `left` tracks the
    // animating width instead of a single stale measurement.
    const menu = menuRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (menu !== null) {
      resizeObserver = new ResizeObserver(update);
      resizeObserver.observe(menu);
    }
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      resizeObserver?.disconnect();
    };
    // `width` participates because a panel swap may change the menu's width
    // class (e.g. ChatMenu's Recent-chats panel widens to 28rem) — the
    // clamped `left` must be recomputed from the new measured width or a
    // right-aligned menu grows past the viewport edge.
  }, [open, align, vertical, width]);

  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      if (!(e.target instanceof Node)) return;
      const target = e.target;
      const inRoot = rootRef.current !== null && rootRef.current.contains(target);
      const inMenu = menuRef.current !== null && menuRef.current.contains(target);
      if (!inRoot && !inMenu) closeMenu();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, closeMenu]);

  const currentPanelIndex = panelIndex ?? 0;
  const direction = usePanelSlideDirection({ open, panelIndex: currentPanelIndex });

  const ctxValue = useMemo<DropdownContextValue>(() => ({ close: closeMenu, dense }), [closeMenu, dense]);
  const toggle = useCallback(
    (event?: ReactMouseEvent<HTMLElement>) => {
      setOpen((o) => {
        if (!o) {
          keyboardOpenRef.current = event !== undefined && event.detail === 0;
          if (event) triggerElRef.current = event.currentTarget;
        }
        return !o;
      });
    },
    [],
  );
  const triggerProps: DropdownTriggerProps = {
    open,
    toggle,
    ariaProps: { "aria-haspopup": "menu", "aria-expanded": open },
  };

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      {trigger(triggerProps)}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={coords}
              className={cn(
                "bg-white rounded-lg shadow-lg border border-warm-200 z-[100] text-sm overflow-y-auto overscroll-contain motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-out",
                dense ? "py-0.5" : "py-1",
                width,
              )}
            >
              {/* Keyed on panelIndex: the panel-swap idiom (VoiceChip/ChatMenu/
                  ContextChip) remounts this wrapper on every panel change, which
                  also re-triggers useOpenMenuFocus's re-anchor observer. The
                  slide direction reflects whether the new panel is deeper
                  (right) or shallower (left); motion-safe: leaves it an instant
                  swap under prefers-reduced-motion. */}
              <div
                key={currentPanelIndex}
                className={cn(
                  direction === "right" && "motion-safe:animate-dropdown-panel-in-right",
                  direction === "left" && "motion-safe:animate-dropdown-panel-in-left",
                )}
              >
                <DropdownContext.Provider value={ctxValue}>
                  {children}
                </DropdownContext.Provider>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// `MenuItem`/`MenuDivider` live in `dropdown-menu-item.tsx` (split out to
// keep this file under the line cap and avoid a value-import cycle — that
// file reads `DropdownContext`, exported above). Callers import them from
// there directly.
