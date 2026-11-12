import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { useAnchoredLayer, type AnchorAlign, type AnchorPoint, type AnchorVertical, type LayerDismissReason } from "./AnchoredLayer";
import { MaterialContext } from "./material";

// The "first focusable menu item" the open/close focus management below
// looks for. Deliberately broader than `[role="menuitem"]`: several existing
// menus nest plain focusable controls (e.g. `RecentFilesMenuBody`'s per-row
// preview/panel buttons, `LandmarkLinksMenuBody`'s group-expand toggles) that
// aren't `MenuItem`s themselves but are still real, reachable menu content.
const FOCUSABLE_MENU_ITEM_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Arrow/Home/End focus movement for a command menu (`role="menu"`). Moves among
// the menu's enabled `[role=menuitem]` rows only, and only when focus is on one
// of those rows or on the panel itself (a pointer-opened point menu focuses the
// panel: ArrowDown and Home go to the first row, ArrowUp and End to the last).
// Focus on a text field, select, or other plain control inside the panel is
// left alone, so typing and the control's own arrow keys keep working.
const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])';

/** Move focus for an Arrow/Home/End keydown inside `menu`; returns whether it handled the key. */
function moveMenuFocus(menu: HTMLElement, event: { key: string; target: EventTarget | null }): boolean {
  const { key, target } = event;
  if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return false;
  const items = [...menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
  const last = items.length - 1;
  if (target === menu) {
    items[key === "ArrowDown" || key === "Home" ? 0 : last]?.focus();
    return items.length > 0;
  }
  if (!(target instanceof HTMLElement) || !target.matches(ITEM_SELECTOR)) return false;
  const current = items.indexOf(target);
  if (current === -1) return false;
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

export type MenuAlign = AnchorAlign;
export type MenuVertical = AnchorVertical;

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

interface MenuCommonProps {
  children: ReactNode;
  /** Menu edge aligned to the trigger or point. Default `"right"` for a trigger, `"left"` at a point. */
  align?: MenuAlign;
  /** Preferred side; the menu flips when the other side has more room. Default `"below"`. */
  vertical?: MenuVertical;
  /** Tailwind width class for the menu. Default `"w-48"`. */
  width?: string;
  /** Tighter padding for menu items + dividers. */
  dense?: boolean;
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

/** A menu opened by its own trigger. */
export interface TriggerMenuProps extends MenuCommonProps {
  /**
   * Render prop that produces the trigger. Wire `toggle` into your
   * element's `onClick` and spread `ariaProps` for accessibility.
   */
  trigger: (props: MenuTriggerProps) => ReactNode;
  /** Outer-layout classes for the wrapper around the trigger. */
  className?: string;
  /** Called whenever the menu transitions from open to closed. Use to reset
   *  per-open ephemeral state (e.g. submenu page). */
  onClose?: () => void;
  at?: never;
}

/**
 * A menu at a point (a context menu). The caller owns `open`; every close
 * (a chosen item, a press outside the panel, Escape, a scroll outside the
 * panel, a resize) calls `onClose`.
 */
export interface PointMenuProps extends MenuCommonProps {
  at: AnchorPoint;
  open: boolean;
  onClose: () => void;
  /** `"keyboard"` (ContextMenu key, Shift+F10) focuses the first item; `"pointer"` focuses the panel. */
  openedBy: "pointer" | "keyboard";
  /** Focus goes back here on close when focus was in the menu, or the close was Escape. */
  returnFocus: HTMLElement | null;
  trigger?: never;
}

export type MenuProps = TriggerMenuProps | PointMenuProps;

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
      first.focus({ preventScroll: true });
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
      first?.focus({ preventScroll: true });
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

/** Whether focus should go back on a close for `reason`: on Escape, or when focus is in the menu. */
function shouldRestoreFocus(menu: HTMLElement | null, reason: LayerDismissReason | "select"): boolean {
  const active = document.activeElement;
  return reason === "escape" || (menu !== null && active !== null && menu.contains(active));
}

/** Calls `onClose` and restores focus on each open→closed transition. */
function useCloseTransition({ open, onClose, restoreFocusRef, returnFocus }: {
  open: boolean;
  onClose: (() => void) | undefined;
  restoreFocusRef: React.MutableRefObject<boolean>;
  returnFocus: () => HTMLElement | null;
}): void {
  const latest = useRef({ onClose, returnFocus });
  useEffect(() => { latest.current = { onClose, returnFocus }; });
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      latest.current.onClose?.();
      if (restoreFocusRef.current) latest.current.returnFocus()?.focus();
      restoreFocusRef.current = false;
    }
    prevOpenRef.current = open;
  }, [open, restoreFocusRef]);
}

export function Menu(props: MenuProps) {
  return props.at === undefined ? <TriggerMenu {...props} /> : <PointMenu {...props} />;
}

function TriggerMenu({ trigger, children, align, vertical, width, dense, className, onClose, pageIndex, kind }: TriggerMenuProps) {
  const isMenu = (kind ?? "menu") === "menu";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Focus management (arrow keys: `moveMenuFocus`): remember the element that
  // opened the menu so close can restore focus to it, and whether the open was
  // via keyboard (focus the first item) or mouse (leave focus alone, no ring).
  const triggerElRef = useRef<HTMLElement | null>(null);
  const keyboardOpenRef = useRef(false);
  const restoreFocusRef = useRef(false);
  useCloseTransition({ open, onClose, restoreFocusRef, returnFocus: () => triggerElRef.current });
  useOpenMenuFocus({ open, menuRef, keyboardOpenRef });

  const closeMenu = useCallback((reason: LayerDismissReason | "select") => {
    restoreFocusRef.current = shouldRestoreFocus(menuRef.current, reason);
    setOpen(false);
  }, []);
  const style = useAnchoredLayer({
    open,
    anchor: { trigger: rootRef },
    layer: menuRef,
    align: align ?? "right",
    vertical: vertical ?? "below",
    // A panel swap may change the width class (a sub-panel that widens).
    measureKey: width,
    onDismiss: closeMenu,
  });
  const toggle = useCallback((event?: ReactMouseEvent<HTMLElement>) => {
    setOpen((o) => {
      if (!o) {
        keyboardOpenRef.current = event !== undefined && event.detail === 0;
        if (event) triggerElRef.current = event.currentTarget;
      }
      return !o;
    });
  }, []);
  const triggerProps: MenuTriggerProps = {
    open,
    toggle,
    ariaProps: isMenu ? { "aria-haspopup": "menu", "aria-expanded": open } : { "aria-expanded": open },
  };

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      {trigger(triggerProps)}
      {open ? (
        <MenuPanel menuRef={menuRef} style={style} isMenu={isMenu} width={width} dense={dense ?? false} pageIndex={pageIndex} open={open} close={closeMenu}>
          {children}
        </MenuPanel>
      ) : null}
    </div>
  );
}

function PointMenu({ at, open, onClose, openedBy, returnFocus, children, align, vertical, width, dense, pageIndex, kind }: PointMenuProps) {
  const isMenu = (kind ?? "menu") === "menu";
  const menuRef = useRef<HTMLDivElement>(null);
  const keyboardOpenRef = useRef(openedBy === "keyboard");
  useEffect(() => { keyboardOpenRef.current = openedBy === "keyboard"; });
  useOpenMenuFocus({ open, menuRef, keyboardOpenRef });
  // A pointer open focuses the panel, so arrow keys and Escape reach the menu.
  useEffect(() => {
    if (open && openedBy === "pointer") menuRef.current?.focus({ preventScroll: true });
  }, [open, openedBy]);

  // Focus goes back before `onClose`: the caller usually unmounts the menu.
  const closeMenu = useCallback((reason: LayerDismissReason | "select") => {
    if (shouldRestoreFocus(menuRef.current, reason)) returnFocus?.focus();
    onClose();
  }, [onClose, returnFocus]);
  const style = useAnchoredLayer({
    open,
    anchor: { at },
    layer: menuRef,
    align: align ?? "left",
    vertical: vertical ?? "below",
    measureKey: width,
    onDismiss: closeMenu,
  });
  if (!open) return null;
  return (
    <MenuPanel menuRef={menuRef} style={style} isMenu={isMenu} width={width} dense={dense ?? false} pageIndex={pageIndex} open={open} close={closeMenu} focusable>
      {children}
    </MenuPanel>
  );
}

/**
 * The open panel, portaled to document.body so it escapes any
 * `overflow-hidden` ancestor (e.g. chat message bubbles); `useAnchoredLayer`
 * places it.
 */
function MenuPanel({ menuRef, style, isMenu, width, dense, pageIndex, open, close, focusable, children }: {
  menuRef: React.RefObject<HTMLDivElement>;
  style: CSSProperties;
  isMenu: boolean;
  width: string | undefined;
  dense: boolean;
  pageIndex: number | undefined;
  open: boolean;
  close: (reason: "select") => void;
  /** The panel itself takes focus (a pointer-opened point menu). */
  focusable?: boolean;
  children: ReactNode;
}) {
  const currentPageIndex = pageIndex ?? 0;
  const direction = usePageSlideDirection({ open, pageIndex: currentPageIndex });
  const ctxValue = useMemo<MenuContextValue>(() => ({ close: () => close("select"), dense, menu: isMenu }), [close, dense, isMenu]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={menuRef}
      role={isMenu ? "menu" : undefined}
      tabIndex={focusable === true ? -1 : undefined}
      onKeyDown={isMenu ? (event) => {
        if (moveMenuFocus(event.currentTarget, event)) event.preventDefault();
      } : undefined}
      style={style}
      className={cn(
        "bg-white rounded-lg shadow-lg border border-warm-200 z-[100] text-sm overflow-y-auto overscroll-contain transition-[width] duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        dense ? "py-0.5" : "py-1",
        width ?? "w-48",
      )}
    >
      {/* Keyed on pageIndex: the panel-swap idiom (VoiceChip/SessionChip/
          PlacePill) remounts this wrapper on every panel change, which
          also re-triggers useOpenMenuFocus's re-anchor observer. The
          slide direction reflects whether the new panel is deeper
          (right) or shallower (left); the global reduced-motion rule
          in index.css makes it an instant swap. */}
      <div
        key={currentPageIndex}
        className={cn(
          direction === "right" && "animate-menu-page-in-right",
          direction === "left" && "animate-menu-page-in-left",
        )}
      >
        <MenuPanelScope value={ctxValue}>{children}</MenuPanelScope>
      </div>
    </div>,
    document.body,
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
