// # The phone landmark search is a fullscreen modal dialog
//
// On a phone the landmark search takes the whole visual viewport (so the list
// stays above the iOS keyboard) as a native modal <dialog> (ModalDialog
// layout="fullscreen"); showModal() makes the rest of the page inert. It
// renders inside the place menu, the newest Escape layer: Escape on a row
// clears the query, then leaves search, and never closes the menu.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { LandmarkList, type SwitchLandmark } from "../../../src/components/AppNav/PlacePill-landmarks.js";
import { Menu } from "../../../src/components/ui/Menu.js";

const landmarks: SwitchLandmark[] = Array.from({ length: 21 }, (_, i) => ({
  path: `place-${i}/Place.landmark.card`,
  dir: `place-${i}`,
  label: `Place ${i}`,
  symbol: null,
  freshCount: 0,
}));

function list(searchOpen: boolean, options?: { shown?: SwitchLandmark[]; onCancelSearch?: () => void }): ReactNode {
  return h(LandmarkList, {
    landmarks: options?.shown ?? landmarks,
    failed: false,
    onRetry: () => {},
    boxSlug: "test1",
    currentDir: null,
    onSelectLandmark: () => {},
    searchOpen,
    onCancelSearch: options?.onCancelSearch ?? (() => {}),
  });
}

/** A phone-width viewport: the dialog branch. */
function phoneViewport(t: { teardown: (fn: () => void) => void }): void {
  const realMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  t.teardown(() => {
    if (realMatchMedia === undefined) Reflect.deleteProperty(window, "matchMedia");
    else Object.defineProperty(window, "matchMedia", realMatchMedia);
  });
}

/** Dialogs opened with showModal(); happy-dom has no `:modal`. */
function recordModals(t: { teardown: (fn: () => void) => void }): Set<HTMLDialogElement> {
  const modals = new Set<HTMLDialogElement>();
  const realShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const showModal = HTMLDialogElement.prototype.showModal;
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      modals.add(this);
      showModal.call(this);
    },
  });
  t.teardown(() => {
    if (realShowModal !== undefined) Object.defineProperty(HTMLDialogElement.prototype, "showModal", realShowModal);
  });
  return modals;
}

function searchDialog(): HTMLDialogElement | null {
  return document.querySelector("dialog[aria-label='Search landmarks']");
}

void test("on a phone, search opens as a named modal dialog focused on the field", async (t) => {
  phoneViewport(t);
  const modals = recordModals(t);
  const view = await mount(list(true));
  const dialog = searchDialog();
  const open = {
    open: dialog?.open ?? null,
    modal: dialog !== null && modals.has(dialog),
    focus: document.activeElement?.id,
    rows: dialog?.querySelector("[aria-label='Matching landmarks']")?.getAttribute("role"),
  };
  await view.rerender(list(false));
  const closed = { dialogPresent: searchDialog() !== null };
  await view.unmount();

  t.check({ open, closed }, {
    open: { open: true, modal: true, focus: "bbx-switch-menu-landmark-search", rows: "group" },
    closed: { dialogPresent: false },
  });
});

// Search is only offered over 20 landmarks. If the list shrinks while the
// dialog is open, the dialog goes away.
void test("when the list shrinks below the search threshold, the dialog closes", async (t) => {
  phoneViewport(t);
  const view = await mount(list(true));
  const before = searchDialog()?.open ?? null;
  await view.rerender(list(true, { shown: landmarks.slice(0, 20) }));
  const after = searchDialog() !== null;
  await view.unmount();

  t.check({ before, after }, { before: true, after: false });
});

void test("Escape on a row goes to the search dialog, not to the menu around it", async (t) => {
  phoneViewport(t);
  const events: string[] = [];
  const view = await mount(h(Menu, {
    at: { x: 20, y: 20 },
    open: true,
    kind: "navigation",
    openedBy: "pointer",
    returnFocus: null,
    onClose: () => events.push("menu closed"),
    children: list(true, { onCancelSearch: () => events.push("search cancelled") }),
  }));
  t.teardown(() => view.unmount());
  const row = document.getElementById("bbx-switch-menu-landmark-first");
  row?.focus();
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  row?.dispatchEvent(escape);
  // happy-dom does not turn Escape into the dialog's cancel; dispatch it.
  await view.act(() => { searchDialog()?.dispatchEvent(new Event("cancel", { cancelable: true })); });

  t.check({ events, escapeConsumed: escape.defaultPrevented }, { events: ["search cancelled"], escapeConsumed: false });
});
