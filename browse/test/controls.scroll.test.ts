// # Scrolling: a tab clipped by its strip, and `scroll --selector` with a hidden first match
//
// Two page-side scripts, run against a stand-in DOM. `checkScript` must scroll a
// control that sits inside the viewport but outside its own scroll container's
// visible area (a tab pushed out of a horizontally scrolled strip), and call
// the control offscreen, not covered, when scrolling cannot bring it back.
// `scrollTargetScript` must pick the first visible match for `scroll --selector`
// and refuse when every match is hidden or zero-size.

import assert from "node:assert/strict";
import vm from "node:vm";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRefHistory, noteAction, saveRefTable } from "../src/act.js";
import { checkScript, parseCheckResult, refAfterActionDetail, refRenumbered } from "../src/controls.js";
import { parseScrollTarget, scrollTargetScript } from "../src/scroll-target.js";
import type { Box, CheckResult } from "../src/controls.js";

class StubNode { static TEXT_NODE = 3; }

class StubElement extends StubNode {
  readonly nodeType = 1;
  readonly isConnected = true;
  readonly disabled = false;
  readonly attrs: Record<string, string>;
  parentElement: StubElement | null = null;
  labels = null;
  readonly tagName: string;
  readonly id: string;
  box: Box;
  readonly overflowX: string;
  readonly shown: boolean;
  constructor(spec: { tagName: string; id: string; box: Box; overflowX?: string; shown?: boolean }) {
    super();
    const options = spec;
    this.tagName = spec.tagName;
    this.id = spec.id;
    this.box = spec.box;
    this.overflowX = options.overflowX ?? "visible";
    this.shown = options.shown ?? true;
    this.attrs = {};
  }
  within(parent: StubElement): this { this.parentElement = parent; return this; }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
  setAttribute(name: string, value: string): void { this.attrs[name] = value; }
  removeAttribute(name: string): void { delete this.attrs[name]; }
  get textContent(): string { return this.id; }
  getBoundingClientRect() {
    const { x, y, width, height } = this.box;
    return { left: x, top: y, right: x + width, bottom: y + height, width, height };
  }
  contains(n: StubElement | null): boolean {
    for (let e = n; e !== null; e = e.parentElement) if (e === this) return true;
    return false;
  }
  checkVisibility(): boolean { return this.shown; }
  scrollIntoView(): void {
    // Centre the element in its parent strip, as the browser does.
    const parent = this.parentElement;
    if (parent === null) return;
    this.box = { ...this.box, x: parent.box.x + (parent.box.width - this.box.width) / 2 };
  }
}
class StubInput extends StubElement {}

function context(document: object): vm.Context {
  return vm.createContext({
    document, Node: StubNode, Element: StubElement, HTMLInputElement: StubInput,
    getComputedStyle: (e: StubElement) => ({ display: "inline", pointerEvents: "auto", overflowX: e.overflowX, overflowY: "visible" }),
    innerWidth: 1280, innerHeight: 800, JSON, Math, Array, String,
  });
}

const STRIP_BOX = { x: 100, y: 10, width: 300, height: 40 };

function tabCheck({ scrollable }: { scrollable: boolean }): { result: CheckResult; tab: StubElement } {
  const body = new StubElement({ tagName: "body", id: "", box: { x: 0, y: 0, width: 1280, height: 800 } });
  const strip = new StubElement({ tagName: "div", id: "strip", box: STRIP_BOX, overflowX: "auto" }).within(body);
  // The Home tab is inside the viewport but scrolled out to the left of the strip.
  const tab = new StubElement({ tagName: "button", id: "home-tab", box: { x: 20, y: 10, width: 80, height: 40 } }).within(strip);
  if (!scrollable) tab.scrollIntoView = () => {};
  const elements = [tab, strip];
  const document = {
    getElementById: (id: string) => elements.find((e) => e.id === id) ?? null,
    elementFromPoint: (x: number, y: number) => elements.find((e) => {
      const r = e.getBoundingClientRect();
      const clipped = e === tab && (x < STRIP_BOX.x || x >= STRIP_BOX.x + STRIP_BOX.width);
      return !clipped && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    }) ?? null,
  };
  const printed: unknown = vm.runInContext(checkScript({ kind: "id", id: "home-tab" }), context(document));
  return { result: parseCheckResult(String(printed)), tab };
}

// ## A tab scrolled out of its strip is scrolled back, not called covered
//
// The viewport test alone passed the tab (it is on screen), so nothing scrolled
// and the strip was the topmost element at the click point.
void test("A tab scrolled out of its strip is scrolled back, not called covered", async (t) => {
  const { result, tab } = tabCheck({ scrollable: true });
  t.check(result, { ok: true, scrolled: true });
  t.check(tab.box.x >= STRIP_BOX.x, true);
});

// ## When scrolling cannot reach it, the refusal says offscreen
void test("When scrolling cannot reach it, the refusal says offscreen", async (t) => {
  const { result } = tabCheck({ scrollable: false });
  assert.ok(!result.ok);
  t.check(result.reason, "offscreen");
  t.check(result.detail.includes("inside div"), true);
});

function scrollTarget(panels: { id: string; box: Box; shown?: boolean }[]): { printed: string; panels: StubElement[] } {
  const made = panels.map((p) => new StubElement({ tagName: "div", id: p.id, box: p.box, shown: p.shown ?? true }));
  const document = {
    querySelectorAll: (selector: string) => (selector === "[role=tabpanel]" ? made : made.filter((e) => selector === "[data-browse-scroll-target]" && "data-browse-scroll-target" in e.attrs)),
  };
  const printed: unknown = vm.runInContext(scrollTargetScript("[role=tabpanel]"), context(document));
  return { printed: String(printed), panels: made };
}

const FULL = { x: 0, y: 0, width: 400, height: 300 };
const NONE = { x: 0, y: 0, width: 0, height: 0 };

// ## `scroll --selector` takes the first visible match
void test("`scroll --selector` takes the first visible match", async (t) => {
  const { printed, panels } = scrollTarget([{ id: "hidden", box: NONE, shown: false }, { id: "zero", box: NONE }, { id: "visible", box: FULL }]);
  t.check(parseScrollTarget(printed), { kind: "marked", skipped: 2 });
  t.check(Object.keys(panels[2]?.attrs ?? {}), ["data-browse-scroll-target"]);
  t.check(Object.keys(panels[0]?.attrs ?? {}), []);
});

// ## It refuses when every match is hidden or zero-size
void test("It refuses when every match is hidden or zero-size", async (t) => {
  const { printed } = scrollTarget([{ id: "a", box: NONE, shown: false }, { id: "b", box: NONE }]);
  t.check(parseScrollTarget(printed), {
    kind: "refuse",
    detail: "2 elements match [role=tabpanel], and every one is hidden or has no box",
  });
});

// ## No match or unreadable output goes to upstream, which words its own error
void test("No match or unreadable output goes to upstream, which words its own error", async (t) => {
  const { printed } = scrollTarget([]);
  t.check(parseScrollTarget(printed), { kind: "upstream" });
  t.check(parseScrollTarget("not json"), { kind: "upstream" });
});

// ## A renumbered ref is described both ways, as a warning
void test("A renumbered ref is described both ways, as a warning", async (t) => {
  t.check(
    refRenumbered({ role: "button", name: "Lend", id: null }, { role: "tab", name: "Home", id: null }),
    'this ref named button "Lend" in the snapshot before last and names tab "Home" now; if you meant the former, act by its id',
  );
});

// ## A page-changing command marks the snapshot's refs stale until the next snapshot
void test("A page-changing command marks the snapshot's refs stale until the next snapshot", async (t) => {
  process.env["AGENT_BROWSER_SOCKET_DIR"] = await mkdtemp(join(tmpdir(), "browse-refs-"));
  process.env["AGENT_BROWSER_SESSION"] = "stale-test";
  await saveRefTable({ e5: { role: "button", name: "Lend", id: null } });
  t.check((await loadRefHistory()).actedSince, null);
  await noteAction("click");
  const after = await loadRefHistory();
  t.check(after.actedSince, "click");
  t.check(Object.keys(after.current), ["e5"]);
  t.check(refAfterActionDetail("@e5", "click"), "@e5 came from a snapshot taken before the last click; run snapshot again");
  await saveRefTable({ e5: { role: "button", name: "Lend", id: null } });
  t.check((await loadRefHistory()).actedSince, null);
});
