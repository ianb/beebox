/**
 * The chat's page-wide keys (shortcuts.ts): Ctrl+L adds a page
 * selection and focuses the composer; Enter with the mic on sends the spoken
 * message and keeps the mic on, without taking Enter from other controls.
 */
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, useRef } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { SelectionCapture } from "../../../src/components/SelectionCapture.js";
import { useChatShortcuts } from "../../../src/components/chat/shortcuts.js";
import type { TranscriptionState } from "../../../src/hooks/useRealtimeTranscription/hook.js";

interface Voice { isTranscribing: boolean; state: TranscriptionState; transcript: string; input: string; sendDisabledReason?: string }

function setup(voice: Voice) {
  const captured: string[] = [];
  const submits: boolean[] = [];
  const log = { captured, submits, ensured: 0 };
  function Harness() {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const ensureComposerVisibleRef = useRef(() => { log.ensured += 1; });
    useChatShortcuts({
      enabled: true, textareaRef, ensureComposerVisibleRef, isTranscribing: voice.isTranscribing,
      transcription: { state: voice.state, transcript: voice.transcript, submitSegment: ({ closeMic }) => { log.submits.push(closeMic); return true; } },
      readInput: () => voice.input, sendDisabledReason: voice.sendDisabledReason,
    });
    return h("div", null,
      h(SelectionCapture, { onCapture: ({ text }: { text: string }) => { log.captured.push(text); }, children: h("p", { id: "page-text" }, "Quoted words") }),
      h("input", { id: "other-field" }),
      h("button", { id: "other-button", type: "button" }, "Other"),
      h("div", { role: "dialog" }, h("button", { id: "dialog-button", type: "button" }, "In dialog")),
      h("textarea", { id: "bbx-composer-input", ref: textareaRef, readOnly: voice.isTranscribing }),
    );
  }
  return { log, Harness };
}

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

/** happy-dom does no layout; the composer's offsetParent says whether it shows (null under `display: none`). */
function showComposer(shown: boolean): void {
  Object.defineProperty(el("bbx-composer-input"), "offsetParent", { configurable: true, get: () => (shown ? document.body : null) });
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
  const { log, Harness } = setup({ isTranscribing: false, state: "idle", transcript: "", input: "" });
  const view = await mount(h(Harness));
  t.teardown(() => view.unmount());
  showComposer(true);
  selectText(el("page-text"));
  const event = key(document.body, { key: "l", ctrlKey: true });
  t.check({ prevented: event.defaultPrevented, captured: log.captured, focused: document.activeElement?.id }, { prevented: true, captured: ["Quoted words"], focused: "bbx-composer-input" });
});

void test("Ctrl+L with no selection only focuses; Cmd+L and Ctrl+Shift+L pass through", async (t) => {
  const { log, Harness } = setup({ isTranscribing: false, state: "idle", transcript: "", input: "" });
  const view = await mount(h(Harness));
  t.teardown(() => view.unmount());
  showComposer(true);
  window.getSelection()?.removeAllRanges();
  el("other-button").focus();
  const meta = key(el("other-button"), { key: "l", metaKey: true });
  const shifted = key(el("other-button"), { key: "L", ctrlKey: true, shiftKey: true });
  t.check({ meta: meta.defaultPrevented, shifted: shifted.defaultPrevented, focused: document.activeElement?.id }, { meta: false, shifted: false, focused: "other-button" });
  key(el("other-button"), { key: "l", ctrlKey: true });
  t.check({ captured: log.captured, focused: document.activeElement?.id }, { captured: [], focused: "bbx-composer-input" });
});

void test("Ctrl+L leaves a dialog's focus alone and opens the phone typing row when the composer is hidden", async (t) => {
  const { log, Harness } = setup({ isTranscribing: false, state: "idle", transcript: "", input: "" });
  const view = await mount(h(Harness));
  t.teardown(() => view.unmount());
  showComposer(false);
  el("dialog-button").focus();
  const inDialog = key(el("dialog-button"), { key: "l", ctrlKey: true });
  t.check({ prevented: inDialog.defaultPrevented, focused: document.activeElement?.id, ensured: log.ensured }, { prevented: false, focused: "dialog-button", ensured: 0 });
  key(document.body, { key: "l", ctrlKey: true });
  t.check(log.ensured, 1);
});

void test("Enter with the mic on sends from the composer or the page and keeps the mic on", async (t) => {
  const { log, Harness } = setup({ isTranscribing: true, state: "recording", transcript: "hello there", input: "" });
  const view = await mount(h(Harness));
  t.teardown(() => view.unmount());
  const fromComposer = key(el("bbx-composer-input"), { key: "Enter" });
  const fromBody = key(document.body, { key: "Enter" });
  t.check({ composer: fromComposer.defaultPrevented, body: fromBody.defaultPrevented, submits: log.submits }, { composer: true, body: true, submits: [false, false] });
});

void test("Enter with the mic on leaves other controls, IME composition and Shift+Enter alone", async (t) => {
  const { log, Harness } = setup({ isTranscribing: true, state: "recording", transcript: "hello there", input: "" });
  const view = await mount(h(Harness));
  t.teardown(() => view.unmount());
  const field = key(el("other-field"), { key: "Enter" });
  const button = key(el("other-button"), { key: "Enter" });
  const dialog = key(el("dialog-button"), { key: "Enter" });
  key(el("bbx-composer-input"), { key: "Enter", isComposing: true });
  key(el("bbx-composer-input"), { key: "Enter", shiftKey: true });
  t.check({ prevented: [field, button, dialog].map((e) => e.defaultPrevented), submits: log.submits }, { prevented: [false, false, false], submits: [] });
});

void test("Enter sends nothing when nothing was said, when sending is blocked, or when the mic is off", async (t) => {
  const cases: Voice[] = [
    { isTranscribing: true, state: "recording", transcript: "  ", input: "" },
    { isTranscribing: true, state: "recording", transcript: "hello", input: "", sendDisabledReason: "Choose a conversation" },
    { isTranscribing: false, state: "idle", transcript: "", input: "typed" },
  ];
  const submitted: boolean[][] = [];
  for (const voice of cases) {
    const { log, Harness } = setup(voice);
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
    { isTranscribing: true, state: "recordingLocal" as const, transcript: "", input: "" },
    { isTranscribing: true, state: "recording" as const, transcript: "", input: "earlier words" },
  ]) {
    const { log, Harness } = setup(voice);
    const view = await mount(h(Harness));
    key(document.body, { key: "Enter" });
    submitted.push(log.submits);
    await view.unmount();
  }
  t.check(submitted, [[false], [false]]);
});
