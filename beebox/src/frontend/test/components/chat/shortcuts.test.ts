/**
 * The chat's page-wide keys (shortcuts.ts): Ctrl+L adds a page
 * selection and focuses the composer; Enter with the mic on sends the spoken
 * message and keeps the mic on, without taking Enter from other controls or
 * from an open menu or dialog.
 */
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, useRef } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { SelectionCapture } from "../../../src/components/SelectionCapture.js";
import { useChatShortcuts } from "../../../src/components/chat/shortcuts.js";
import type { TranscriptionState } from "../../../src/hooks/useRealtimeTranscription/hook.js";

interface Voice { isTranscribing: boolean; state: TranscriptionState; transcript: string; input: string; sendDisabledReason?: string }
/** What else is on the page: an open menu or dialog, and the phone typing row. */
interface Page { overlay?: "menu" | "dialog"; phoneRow?: boolean }

function setup(voice: Voice, page: Page) {
  const captured: string[] = [];
  const submits: boolean[] = [];
  const log = { captured, submits, ensured: 0 };
  function Harness() {
    const ensureComposerVisibleRef = useRef(() => { log.ensured += 1; });
    useChatShortcuts({
      enabled: true, ensureComposerVisibleRef, isTranscribing: voice.isTranscribing,
      transcription: { state: voice.state, transcript: voice.transcript, submitSegment: ({ closeMic }) => { log.submits.push(closeMic); return true; } },
      readInput: () => voice.input, sendDisabledReason: voice.sendDisabledReason,
    });
    return h("div", null,
      h(SelectionCapture, { onCapture: ({ text }: { text: string }) => { log.captured.push(text); }, children: h("p", { id: "page-text" }, "Quoted words") }),
      h("input", { id: "other-field" }),
      h("button", { id: "other-button", type: "button" }, "Other"),
      // Inline search results, mounted at rest (SearchResults.tsx): not an overlay.
      h("div", { role: "listbox", "aria-label": "Search results" }),
      page.overlay === "menu" ? h("div", { role: "menu", tabIndex: -1 }, h("button", { id: "menu-item", role: "menuitem", type: "button" }, "Item")) : null,
      page.overlay === "dialog" ? h("dialog", { open: true }, h("button", { id: "dialog-button", type: "button" }, "In dialog")) : null,
      h("textarea", { id: "bbx-composer-input", readOnly: voice.isTranscribing }),
      page.phoneRow === true ? h("textarea", { id: "bbx-composer-input-mobile" }) : null,
    );
  }
  return { log, Harness };
}

const IDLE: Voice = { isTranscribing: false, state: "idle", transcript: "", input: "" };
const DICTATING: Voice = { isTranscribing: true, state: "recording", transcript: "hello there", input: "" };

function key(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`#${id} missing`);
  return found;
}

/** happy-dom does no layout; offsetParent says whether a textarea shows (null under `display: none`). */
function setShown(id: string, shown: boolean): void {
  Object.defineProperty(el(id), "offsetParent", { configurable: true, get: () => (shown ? document.body : null) });
}

function selectText(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  if (selection === null) throw new Error("no selection");
  selection.removeAllRanges();
  selection.addRange(range);
}

void test("Ctrl+L adds the page selection to the message and focuses the composer", async (t) => {
  const { log, Harness } = setup(IDLE, {});
  const view = await mount(h(Harness));
  t.teardown(() => view.unmount());
  setShown("bbx-composer-input", true);
  selectText(el("page-text"));
  const event = key(document.body, { key: "l", ctrlKey: true });
  t.check({ prevented: event.defaultPrevented, captured: log.captured, focused: document.activeElement?.id }, { prevented: true, captured: ["Quoted words"], focused: "bbx-composer-input" });
});

void test("Ctrl+L with no selection only focuses; Cmd+L and Ctrl+Shift+L pass through", async (t) => {
  const { log, Harness } = setup(IDLE, {});
  const view = await mount(h(Harness));
  t.teardown(() => view.unmount());
  setShown("bbx-composer-input", true);
  window.getSelection()?.removeAllRanges();
  el("other-field").focus();
  const meta = key(el("other-field"), { key: "l", metaKey: true });
  const shifted = key(el("other-field"), { key: "L", ctrlKey: true, shiftKey: true });
  t.check({ meta: meta.defaultPrevented, shifted: shifted.defaultPrevented, focused: document.activeElement?.id }, { meta: false, shifted: false, focused: "other-field" });
  key(el("other-field"), { key: "l", ctrlKey: true });
  t.check({ captured: log.captured, focused: document.activeElement?.id }, { captured: [], focused: "bbx-composer-input" });
});

void test("Ctrl+L leaves an open dialog alone", async (t) => {
  const { log, Harness } = setup(IDLE, { overlay: "dialog" });
  const view = await mount(h(Harness));
  t.teardown(() => view.unmount());
  setShown("bbx-composer-input", true);
  el("dialog-button").focus();
  const event = key(el("dialog-button"), { key: "l", ctrlKey: true });
  t.check({ prevented: event.defaultPrevented, focused: document.activeElement?.id, ensured: log.ensured }, { prevented: false, focused: "dialog-button", ensured: 0 });
});

// On a phone the desktop row is `hidden sm:flex`: an open typing row takes
// the focus itself; a closed one is opened (useEnsureComposerVisible).
void test("Ctrl+L on a phone focuses an open typing row, else opens it", async (t) => {
  const open = setup(IDLE, { phoneRow: true });
  const view = await mount(h(open.Harness));
  setShown("bbx-composer-input", false);
  setShown("bbx-composer-input-mobile", true);
  key(document.body, { key: "l", ctrlKey: true });
  t.check({ focused: document.activeElement?.id, ensured: open.log.ensured }, { focused: "bbx-composer-input-mobile", ensured: 0 });
  await view.unmount();
  const closed = setup(IDLE, {});
  const closedView = await mount(h(closed.Harness));
  t.teardown(() => closedView.unmount());
  setShown("bbx-composer-input", false);
  key(document.body, { key: "l", ctrlKey: true });
  t.check(closed.log.ensured, 1);
});

void test("Enter with the mic on sends from the composer or the page and keeps the mic on", async (t) => {
  const { log, Harness } = setup(DICTATING, {});
  const view = await mount(h(Harness));
  t.teardown(() => view.unmount());
  const fromComposer = key(el("bbx-composer-input"), { key: "Enter" });
  const fromBody = key(document.body, { key: "Enter" });
  t.check({ composer: fromComposer.defaultPrevented, body: fromBody.defaultPrevented, submits: log.submits }, { composer: true, body: true, submits: [false, false] });
});

void test("Enter with the mic on leaves other controls, IME composition and Shift+Enter alone", async (t) => {
  const { log, Harness } = setup(DICTATING, {});
  const view = await mount(h(Harness));
  t.teardown(() => view.unmount());
  const field = key(el("other-field"), { key: "Enter" });
  const button = key(el("other-button"), { key: "Enter" });
  key(el("bbx-composer-input"), { key: "Enter", isComposing: true });
  key(el("bbx-composer-input"), { key: "Enter", shiftKey: true });
  t.check({ prevented: [field, button].map((e) => e.defaultPrevented), submits: log.submits }, { prevented: [false, false], submits: [] });
});

// A mouse-opened menu can leave focus on the composer (or, in Safari, the
// body); Enter then belongs to the menu, not the mic.
void test("Enter with the mic on sends nothing while a menu or dialog is open, wherever focus is", async (t) => {
  const submitted: boolean[][] = [];
  for (const overlay of ["menu", "dialog"] as const) {
    const { log, Harness } = setup(DICTATING, { overlay });
    const view = await mount(h(Harness));
    key(el("bbx-composer-input"), { key: "Enter" });
    key(document.body, { key: "Enter" });
    submitted.push(log.submits);
    await view.unmount();
  }
  t.check(submitted, [[], []]);
});

void test("Enter sends nothing when nothing was said, when sending is blocked, or when the mic is off", async (t) => {
  const cases: Voice[] = [
    { ...DICTATING, transcript: "  " },
    { ...DICTATING, sendDisabledReason: "Choose a conversation" },
    { ...IDLE, input: "typed" },
  ];
  const submitted: boolean[][] = [];
  for (const voice of cases) {
    const { log, Harness } = setup(voice, {});
    const view = await mount(h(Harness));
    key(document.body, { key: "Enter" });
    submitted.push(log.submits);
    await view.unmount();
  }
  t.check(submitted, [[], [], []]);
});

void test("Enter sends a segment recorded with live text paused, and prior composer text alone", async (t) => {
  const submitted: boolean[][] = [];
  for (const voice of [
    { ...DICTATING, state: "recordingLocal" as const, transcript: "" },
    { ...DICTATING, transcript: "", input: "earlier words" },
  ]) {
    const { log, Harness } = setup(voice, {});
    const view = await mount(h(Harness));
    key(document.body, { key: "Enter" });
    submitted.push(log.submits);
    await view.unmount();
  }
  t.check(submitted, [[false], [false]]);
});
