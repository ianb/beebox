/**
 * The unified app bar's chrome channel (docs/plans/top-nav-ia.md Track C2).
 *
 * The bar is global (`AppLayout` renders `AppNav` above the route `Outlet`),
 * but two of the things it shows are *page* state: the place a page is in,
 * and — on chat pages — the session/voice chips plus the full "here" menu
 * body, which need chat-owned state (`messages`, `onZoomView`) the bar can't
 * reach. This module is the channel between them: pages publish, the bar
 * renders, and the DOM relocation happens through `createPortal` on the
 * page's side, so state ownership never moves.
 *
 * **Render stability is the whole design.** A portal relocates DOM; it does
 * NOT isolate renders — the publishing page (`InteractiveChat`) re-renders on
 * every streaming token, and the bar must not. Three rules hold that:
 *
 *  1. **Split read/write contexts.** Pages consume only the WRITE context,
 *     whose functions are `[]`-dep stable, so a page never re-renders when a
 *     published value changes. The bar consumes the READ context.
 *  2. **State lives in the provider, `children` passes straight through.**
 *     `AppBarChromeProvider` takes `children` as a prop, so a publication
 *     re-renders the provider but reuses the same child element — React bails
 *     out of the whole `Outlet` subtree. Only context consumers re-render.
 *  3. **Publications happen in effects with primitive deps** (`dir`, `label`
 *     strings), never per render, and every portaled component is
 *     `React.memo`'d with referentially stable props (the
 *     workspace card rendering discipline — `components/chat/CLAUDE.md`).
 *
 * Ownership tokens: each `useAppBarPlace` instance carries an identity, and
 * cleanup clears the published place ONLY if it still owns it. Without that,
 * an unmounting page's cleanup (which React may run after the incoming page's
 * effects) would erase the newer page's value and leave the pill blank.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { useDropdownClose } from "./ui/Dropdown";

/** Where the user is: a display label plus the box dir it lives in. */
export interface AppBarPlace {
  /** Box-relative dir (`""` = box root); null when the place has none. */
  dir: string | null;
  /** Face text for the pill's left half when no landmark upgrades it. */
  label: string;
}

/**
 * A registered menu portal target. `close` is the enclosing `Dropdown`'s
 * close function: portaled children keep the React context of the tree they
 * were *rendered* from, not the DOM they land in, so the page must re-provide
 * it (see `PortaledMenuScope`) or its `MenuItem`s won't dismiss the menu.
 */
export interface AppBarMenuSlot {
  element: HTMLElement;
  close: () => void;
}

interface AppBarChromeValues {
  place: AppBarPlace | null;
  /**
   * The bar's chip container, or null before the bar mounts (it never does
   * under `?nativeComposer=1`). Exactly one: the bar is a single responsive row (C3),
   * so there is no hidden duplicate to portal into.
   */
  chipSlot: HTMLElement | null;
  /**
   * The here-menu target, or null when no here menu is open. Only ever one:
   * the container mounts inside the pill's here `Dropdown`, which exists only
   * while open, and only the visible bar's pill can be opened.
   */
  hereSlot: AppBarMenuSlot | null;
  /** Whether a page has claimed the here menu (chat has; other pages haven't). */
  hereMenuClaimed: boolean;
  /**
   * The switch menu's "Recent files" sub-panel target — same lifecycle as
   * `hereSlot` (mounts inside the open switch `Dropdown`).
   */
  recentSlot: AppBarMenuSlot | null;
  /** Whether a page will supply the Recent-files panel (chat pages do). */
  recentFilesClaimed: boolean;
}

interface AppBarChromeWriters {
  publishPlace: (owner: object, place: AppBarPlace) => void;
  clearPlace: (owner: object) => void;
  claimHereMenu: (owner: object) => void;
  releaseHereMenu: (owner: object) => void;
  claimRecentFiles: (owner: object) => void;
  releaseRecentFiles: (owner: object) => void;
  setChipSlot: (element: HTMLElement) => void;
  clearChipSlot: (element: HTMLElement) => void;
  setHereSlot: (slot: AppBarMenuSlot | null) => void;
  setRecentSlot: (slot: AppBarMenuSlot | null) => void;
}

const EMPTY_VALUES: AppBarChromeValues = {
  place: null,
  chipSlot: null,
  hereSlot: null,
  hereMenuClaimed: false,
  recentSlot: null,
  recentFilesClaimed: false,
};

const AppBarChromeReadContext = createContext<AppBarChromeValues>(EMPTY_VALUES);
const AppBarChromeWriteContext = createContext<AppBarChromeWriters | null>(null);

/**
 * Provides both contexts. Mounted by `AppLayout` around the whole shell —
 * including the bar and the `Outlet` — with `children` passed through so a
 * publication can't re-render the routed page (see the file header, rule 2).
 */
export function AppBarChromeProvider({ children }: { children: ReactNode }) {
  const [place, setPlace] = useState<{ owner: object; place: AppBarPlace } | null>(null);
  const [hereOwner, setHereOwner] = useState<object | null>(null);
  const [recentOwner, setRecentOwner] = useState<object | null>(null);
  const [chipSlot, setChipSlot] = useState<HTMLElement | null>(null);
  const [hereSlot, setHereSlot] = useState<AppBarMenuSlot | null>(null);
  const [recentSlot, setRecentSlot] = useState<AppBarMenuSlot | null>(null);

  const writers = useMemo<AppBarChromeWriters>(
    () => ({
      publishPlace: (owner, next) => setPlace({ owner, place: next }),
      clearPlace: (owner) => setPlace((cur) => (cur !== null && cur.owner === owner ? null : cur)),
      claimHereMenu: (owner) => setHereOwner(owner),
      releaseHereMenu: (owner) => setHereOwner((cur) => (cur === owner ? null : cur)),
      claimRecentFiles: (owner) => setRecentOwner(owner),
      releaseRecentFiles: (owner) => setRecentOwner((cur) => (cur === owner ? null : cur)),
      setChipSlot: (element) => setChipSlot(element),
      // Owner-scoped, like the place publication: a slot that unmounts after
      // its replacement registered must not clear the live one.
      clearChipSlot: (element) => setChipSlot((cur) => (cur === element ? null : cur)),
      setHereSlot,
      setRecentSlot,
    }),
    [],
  );

  const values = useMemo<AppBarChromeValues>(
    () => ({
      place: place === null ? null : place.place,
      chipSlot,
      hereSlot,
      hereMenuClaimed: hereOwner !== null,
      recentSlot,
      recentFilesClaimed: recentOwner !== null,
    }),
    [place, chipSlot, hereSlot, hereOwner, recentSlot, recentOwner],
  );

  return (
    <AppBarChromeWriteContext.Provider value={writers}>
      <AppBarChromeReadContext.Provider value={values}>
        {children}
      </AppBarChromeReadContext.Provider>
    </AppBarChromeWriteContext.Provider>
  );
}

/**
 * Publish this page's place to the bar. Pass null to publish nothing (the bar
 * falls back to its route-derived label). The effect's deps are the two
 * primitives, so a page that re-renders per streaming token republishes
 * nothing.
 */
export function useAppBarPlace(place: AppBarPlace | null): void {
  const writers = useContext(AppBarChromeWriteContext);
  const ownerRef = useRef<object>({});
  const dir = place === null ? null : place.dir;
  const label = place === null ? null : place.label;

  useEffect(() => {
    const owner = ownerRef.current;
    if (writers !== null) {
      if (label === null) writers.clearPlace(owner);
      else writers.publishPlace(owner, { dir, label });
    }
    // Owner-scoped: a stale unmount must not erase a newer page's value.
    return () => { if (writers !== null) writers.clearPlace(owner); };
  }, [writers, dir, label]);
}

/**
 * Claim the here menu: tells the pill that this page will portal a full menu
 * body in, so it renders the slot container instead of its own reduced menu.
 * Same owner-token discipline as `useAppBarPlace`.
 */
export function useAppBarHereMenuClaim(claimed: boolean): void {
  const writers = useContext(AppBarChromeWriteContext);
  const ownerRef = useRef<object>({});

  useEffect(() => {
    const owner = ownerRef.current;
    if (writers !== null) {
      if (claimed) writers.claimHereMenu(owner);
      else writers.releaseHereMenu(owner);
    }
    return () => { if (writers !== null) writers.releaseHereMenu(owner); };
  }, [writers, claimed]);
}

/**
 * Claim the switch menu's "Recent files" row: tells the pill that this page
 * will portal the panel body in, so the row (and its sub-panel) render at
 * all. Same owner-token discipline as the here-menu claim.
 */
export function useAppBarRecentFilesClaim(claimed: boolean): void {
  const writers = useContext(AppBarChromeWriteContext);
  const ownerRef = useRef<object>({});

  useEffect(() => {
    const owner = ownerRef.current;
    if (writers !== null) {
      if (claimed) writers.claimRecentFiles(owner);
      else writers.releaseRecentFiles(owner);
    }
    return () => { if (writers !== null) writers.releaseRecentFiles(owner); };
  }, [writers, claimed]);
}

/** The portal targets a page can render into. Null until the bar mounts
 *  (it doesn't at all under `?nativeComposer=1`), so callers must guard on presence. */
export function useAppBarSlots(): {
  chipSlot: HTMLElement | null;
  hereSlot: AppBarMenuSlot | null;
  recentSlot: AppBarMenuSlot | null;
} {
  const { chipSlot, hereSlot, recentSlot } = useContext(AppBarChromeReadContext);
  return { chipSlot, hereSlot, recentSlot };
}

/** Whether a page will supply the Recent-files panel. Read by the bar. */
export function useAppBarRecentFilesClaimed(): boolean {
  return useContext(AppBarChromeReadContext).recentFilesClaimed;
}

/**
 * The Recent-files sub-panel's container — the switch-menu counterpart of
 * `AppBarHereSlot`, with the same inside-the-open-Dropdown mounting rationale.
 */
export function AppBarRecentFilesSlot() {
  const writers = useContext(AppBarChromeWriteContext);
  const close = useDropdownClose();
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (writers === null) return;
      writers.setRecentSlot(element === null ? null : { element, close });
    },
    [writers, close],
  );
  return <div ref={setRef} />;
}

/** The place a page published, or null when none has. Read by the bar. */
export function useAppBarPublishedPlace(): AppBarPlace | null {
  return useContext(AppBarChromeReadContext).place;
}

/** Whether a page will supply the here menu's body. Read by the bar. */
export function useAppBarHereMenuClaimed(): boolean {
  return useContext(AppBarChromeReadContext).hereMenuClaimed;
}

/**
 * The bar's chip container: an inline-flex row that occupies nothing until a
 * page portals chips into it (a `gap` applies only between children).
 */
export function AppBarChipSlot() {
  const writers = useContext(AppBarChromeWriteContext);
  // React 18 ref callbacks can't return a cleanup, and the unmount call passes
  // null — so the element being retired is remembered here.
  const mountedRef = useRef<HTMLElement | null>(null);
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (writers === null) return;
      if (mountedRef.current !== null) writers.clearChipSlot(mountedRef.current);
      mountedRef.current = element;
      if (element !== null) writers.setChipSlot(element);
    },
    [writers],
  );
  return <div ref={setRef} className="flex items-center gap-2 shrink-0" />;
}

/**
 * The here menu's container, rendered by the pill INSIDE its open `Dropdown`.
 * Mounting it there (rather than keeping a hidden container alive elsewhere)
 * is what keeps `Dropdown`'s open/close, focus-restore and click-outside
 * semantics untouched: the menu content lives where the menu is, and the
 * page's portal follows it. The registration lands during the same commit as
 * the open, so the page's portal fills it before the browser paints.
 */
export function AppBarHereSlot() {
  const writers = useContext(AppBarChromeWriteContext);
  const close = useDropdownClose();
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (writers === null) return;
      writers.setHereSlot(element === null ? null : { element, close });
    },
    [writers, close],
  );
  return <div ref={setRef} />;
}
