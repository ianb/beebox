import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { useDismiss } from "../../hooks/useDismiss";
import { MaterialContext } from "./material";

// The "first focusable menu item" the open/close focus management below
// looks for. Deliberately broader than `[role="menuitem"]`: several existing
// menus nest plain focusable controls (e.g. `RecentFilesMenuBody`'s per-row
// preview/panel buttons, `LandmarkLinksMenuBody`'s group-expand toggles) that
// aren't `MenuItem`s themselves but are still real, reachable menu content.
const FOCUSABLE_MENU_ITEM_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Arrow/Home/End focus movement for a command menu (`role="menu"`). Moves among
// the menu's enabled `[role=menuitem]` rows only, and only when focus is on one
// of those rows. Focus on a text field, select, or other plain control inside
// the panel is left alone, so typing and the control's own arrow keys keep working.
const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])';

/** Move focus for an Arrow/Home/End keydown inside `menu`; returns whether it handled the key. */
function moveMenuFocus(menu: HTMLElement, event: { key: string; target: EventTarget | null }): boolean {
  const { key, target } = event;
  if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return false;
  if (!(target instanceof HTMLElement) || !target.matches(ITEM_SELECTOR)) return false;
  const items = [...menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
  const current = items.indexOf(target);
  if (current === -1) return false;
  const last = items.length - 1;
  const next = key === "Home" ? 0 : key === "End" ? last : key === "ArrowDown" ? (current === last ? 0 : current + 1) : (current === 0 ? last : current - 1);
  items[next]?.focus();
  return true;
}

export interface MenuContextValue {
  close: () => void;
  /** Tighter padding for menu items + dividers. */
  dense: boolean;
  /** True when the panel is a `role="menu"`; false for a list of links, whose rows carry no menu role. */
  menu: boolean;
}

/** Exported for `MenuItem`/`MenuDivider` (`menu-item.tsx`) only. */
export const MenuContext = createContext<MenuContextValue | null>(null);

/** Close the enclosing Menu. No-op outside one. For custom menu content. */
export function useMenuClose(): () => void {
  const ctx = useContext(MenuContext);
  return ctx !== null ? ctx.close : () => {};
}

/** The role a menu row takes: `"menuitem"` in a command menu, none in a navigation list or outside a Menu's panel. */
export function useMenuItemRole(): "menuitem" | undefined {
  const ctx = useContext(MenuContext);
  return ctx === null || ctx.menu ? "menuitem" : undefined;
}

export type MenuAlign = "left" | "right";
export type MenuVertical = "below" | "above";

export interface MenuTriggerProps {
  open: boolean;
  /**
   * Wire into your trigger element's `onClick` (pass the reference directly,
   * e.g. `onClick={toggle}`) — the click event is used to detect a
   * keyboard-activated open (`event.detail === 0`) and to record the trigger
   * element for focus restoration on close.
   */
  toggle: (event?: ReactMouseEvent<HTMLElement>) => void;
  /** Props to spread on your trigger element for correct ARIA. */
  ariaProps: { "aria-haspopup"?: "menu"; "aria-expanded": boolean };
}

export interface MenuProps {
  /**
   * Render prop that produces the trigger. Wire `toggle` into your
   * element's `onClick` and spread `ariaProps` for accessibility.
   */
  trigger: (props: MenuTriggerProps) => ReactNode;
  children: ReactNode;
  /** Menu edge aligned to the trigger. Default `"right"`. */
  align?: MenuAlign;
  /** Whether the menu opens below or above the trigger. Default `"below"`. */
  vertical?: MenuVertical;
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
  pageIndex?: number;
  /**
   * `"menu"` (default) is a command menu: `role="menu"`, `aria-haspopup="menu"`
   * on the trigger, rows are `role="menuitem"`, and ArrowUp/ArrowDown/Home/End
   * move focus among the rows. `"navigation"` is a list of links: a plain
   * disclosure with no menu roles.
   */
  kind?: "menu" | "navigation";
}

// The open-state half of the focus management (arrow keys: `moveMenuFocus`). Two concerns, both scoped to an open menu:
//
// 1. Focus the first menu item when the menu opens via a keyboard activation
//    of the trigger (a keyboard-activated click has `event.detail === 0`).
//    Mouse opens leave focus untouched so no focus ring appears. Some menus
//    (e.g. `RecentFilesMenuBody`) mount a loading row before their real content,
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
// so the very first render after a `pageIndex` change already picks the
// right class — an effect would land one render late. Calling `setState`
// here is safe because it's conditioned on an actual change, so it can't
// loop. The result is null until a panel swap happens WITHIN the current
// open session: opening the menu itself must not slide (and must not reuse
// the direction left over from a previous session — the onClose reset back
// to the root panel records a spurious "left" that would otherwise play on
// the next open), so each closed→open transition clears it.
function usePageSlideDirection({ open, pageIndex }: { open: boolean; pageIndex: number }): "right" | "left" | null {
  const [prevPageIndex, setPrevPageIndex] = useState(pageIndex);
  const [direction, setDirection] = useState<"right" | "left" | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDirection(null);
  }
  if (pageIndex !== prevPageIndex) {
    setDirection(open ? (pageIndex > prevPageIndex ? "right" : "left") : null);
    setPrevPageIndex(pageIndex);
  }
  return direction;
}

/** Visible viewport bounds for fixed popovers, including iOS keyboard resize. */
function visibleViewport() {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
  };
}

export function Menu({ trigger, children, align: alignArg, vertical: verticalArg, width: widthArg, dense: denseArg, className, onClose, pageIndex, kind: kindArg }: MenuProps) {
  const align = alignArg ?? "right";
  const vertical = verticalArg ?? "below";
  const width = widthArg ?? "w-48";
  const dense = denseArg ?? false;
  const isMenu = (kindArg ?? "menu") === "menu";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Focus management (arrow keys: `moveMenuFocus`): remember the element that opened the menu so close can restore focus to
  // it, whether the open was via keyboard (focus the first item) or mouse
  // (leave focus alone, no visible focus ring).
  const triggerElRef = useRef<HTMLElement | null>(null);
  const keyboardOpenRef = useRef(false);
  const restoreFocusRef = useRef(false);

  // Fire onClose + restore focus on the open→closed transition.
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      const bbx = onCloseRef.current;
      if (bbx) bbx();
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
      // On iOS the on-screen keyboard reduces the visual viewport while the
      // layout viewport (innerHeight) stays full-size. Portaled fixed menus
      // must be clamped to the visible area or their lower rows sit behind it.
      const { width: vw, height: vh, left: viewportLeft, top: viewportTop } = visibleViewport();
      const next: CSSProperties = { position: "fixed", maxWidth: vw - margin * 2 };
      // Vertical: anchor the near edge to the trigger, then bound the far edge
      // to the viewport so a tall menu gains a scrollbar instead of overflowing.
      if (vertical === "above") {
        next.bottom = window.innerHeight - rect.top + gap;
        next.maxHeight = rect.top - gap - viewportTop - margin;
      } else {
        next.top = rect.bottom + gap;
        next.maxHeight = viewportTop + vh - (rect.bottom + gap) - margin;
      }
      // Horizontal: align to the trigger per `align`, then clamp the whole box
      // within [margin, vw - margin]. `right-0`-style alignment measured only
      // the trigger's x, so a wide menu beside a mid-header trigger slid off the
      // left edge; clamping the computed left keeps it on-screen either way.
      const menu = menuRef.current;
      const rawWidth = menu ? menu.getBoundingClientRect().width : 0;
      const effWidth = Math.min(rawWidth, vw - margin * 2);
      const anchored = align === "right" ? rect.right - effWidth : rect.left;
      next.left = Math.max(viewportLeft + margin, Math.min(anchored, viewportLeft + vw - margin - effWidth));
      setCoords(next);
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    // A width-class swap (a menu whose sub-panel needs more room) now eases via
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
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      resizeObserver?.disconnect();
    };
    // `width` participates because a panel swap may change the menu's width
    // class (a sub-panel that widens) — the
    // clamped `left` must be recomputed from the new measured width or a
    // right-aligned menu grows past the viewport edge.
  }, [open, align, vertical, width]);

  useDismiss({ root: rootRef, portal: menuRef, open, onDismiss: closeMenu });

  const currentPageIndex = pageIndex ?? 0;
  const direction = usePageSlideDirection({ open, pageIndex: currentPageIndex });

  const ctxValue = useMemo<MenuContextValue>(() => ({ close: closeMenu, dense, menu: isMenu }), [closeMenu, dense, isMenu]);
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
  const triggerProps: MenuTriggerProps = {
    open,
    toggle,
    ariaProps: isMenu ? { "aria-haspopup": "menu", "aria-expanded": open } : { "aria-expanded": open },
  };

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      {trigger(triggerProps)}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role={isMenu ? "menu" : undefined}
              onKeyDown={isMenu ? (event) => {
                if (moveMenuFocus(event.currentTarget, event)) event.preventDefault();
              } : undefined}
              style={coords}
              className={cn(
                "bg-white rounded-lg shadow-lg border border-warm-200 z-[100] text-sm overflow-y-auto overscroll-contain motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-out",
                dense ? "py-0.5" : "py-1",
                width,
              )}
            >
              {/* Keyed on pageIndex: the panel-swap idiom (VoiceChip/SessionChip/
                  PlacePill) remounts this wrapper on every panel change, which
                  also re-triggers useOpenMenuFocus's re-anchor observer. The
                  slide direction reflects whether the new panel is deeper
                  (right) or shallower (left); motion-safe: leaves it an instant
                  swap under prefers-reduced-motion. */}
              <div
                key={currentPageIndex}
                className={cn(
                  direction === "right" && "motion-safe:animate-menu-page-in-right",
                  direction === "left" && "motion-safe:animate-menu-page-in-left",
                )}
              >
                <MenuPanelScope value={ctxValue}>{children}</MenuPanelScope>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * The open menu's contexts: its Menu, and no material. The menu is a
 * white app panel, so it keeps app ink when its trigger sits in a material.
 */
function MenuPanelScope({ value, children }: { value: MenuContextValue; children: ReactNode }) {
  return (
    <MaterialContext.Provider value={false}>
      <MenuContext.Provider value={value}>{children}</MenuContext.Provider>
    </MaterialContext.Provider>
  );
}

/**
 * Re-establish a Menu's context on the far side of a `createPortal`.
 *
 * A portal moves DOM, not React context: menu content rendered by one tree
 * and portaled into a Menu that lives in another (the app bar's here
 * menu, `components/app-bar-chrome.tsx`) would otherwise see no
 * `MenuContext`, and its `MenuItem`s would silently fail to close the
 * menu. Wrap the portaled content in this with the slot's `close`.
 */
export function PortaledMenuScope({ close, menu, children }: { close: () => void; /** False when the host Menu is `kind="navigation"`. Default true. */ menu?: boolean; children: ReactNode }) {
  const isMenu = menu ?? true;
  const value = useMemo<MenuContextValue>(() => ({ close, dense: false, menu: isMenu }), [close, isMenu]);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

// `MenuItem`/`MenuDivider` live in `menu-item.tsx` (split out to
// keep this file under the line cap and avoid a value-import cycle — that
// file reads `MenuContext`, exported above). Callers import them from
// there directly.
