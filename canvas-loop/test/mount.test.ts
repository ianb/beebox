// mountSketch / attachSketch behavior in bare Node, against a minimal fake DOM
// (no jsdom: the surface the mount code touches is small enough to fake
// honestly, and node --test runs each file in its own process so the globals
// installed here can't leak into the SSR test's asserted-DOM-free env).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mountSketch, sanitizeInitialParams } from "@ianbicking/canvas-loop/browser";
import type { ParamsDecl } from "@ianbicking/canvas-loop";
import { isTeaModule, toTeaModule } from "../src/headless/tea-load.js";

// ── fake DOM ─────────────────────────────────────────────────────────

type Listener = (event: unknown) => void;

class FakeElement {
  tagName: string;
  className = "";
  textContent = "";
  type = "";
  value = "";
  min = "";
  max = "";
  step = "";
  checked = false;
  selected = false;
  tabIndex = -1;
  width = 0;
  height = 0;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  listeners = new Map<string, Listener[]>();
  addedListeners = 0;
  removedListeners = 0;

  constructor(tagName: string) {
    this.tagName = tagName;
  }
  append(...kids: FakeElement[]): void {
    for (const kid of kids) {
      kid.parent = this;
      this.children.push(kid);
    }
  }
  replaceChildren(...kids: FakeElement[]): void {
    for (const kid of this.children) kid.parent = null;
    this.children = [];
    this.append(...kids);
  }
  remove(): void {
    if (this.parent === null) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type: string, fn: Listener): void {
    this.addedListeners += 1;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.removedListeners += 1;
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  focus(): void {
    // Focus is irrelevant to these tests; the listener wiring calls it.
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
  getContext(kind: string): unknown {
    // A permissive 2D-context stand-in: method calls no-op, property sets stick.
    if (kind !== "2d") return null;
    // Property writes land on the target; reads of unset names yield a no-op
    // function, so any context method call succeeds.
    const target: Record<PropertyKey, unknown> = {};
    return new Proxy(target, {
      get: (t, prop) => (prop in t ? t[prop] : () => null),
    });
  }
  click(): void {
    for (const fn of this.listeners.get("click") ?? []) fn({});
  }
  /** Depth-first search of the fake tree. */
  find(match: (el: FakeElement) => boolean): FakeElement | null {
    if (match(this)) return this;
    for (const kid of this.children) {
      const hit = kid.find(match);
      if (hit !== null) return hit;
    }
    return null;
  }
}

function asHTMLElement(el: FakeElement): HTMLElement {
  // eslint-disable-next-line no-restricted-syntax -- test boundary: the fake element stands in for the DOM element mount code duck-types against
  return el as unknown as HTMLElement;
}

const rafState: {
  next: number;
  pending: Map<number, (now: number) => void>;
  cancelled: number[];
  now: number;
} = {
  next: 1,
  pending: new Map(),
  cancelled: [],
  now: 0,
};

Object.assign(globalThis, {
  document: { createElement: (tag: string) => new FakeElement(tag) },
  requestAnimationFrame: (cb: (now: number) => void): number => {
    rafState.pending.set(rafState.next, cb);
    return rafState.next++;
  },
  cancelAnimationFrame: (id: number): void => {
    rafState.cancelled.push(id);
    rafState.pending.delete(id);
  },
});

/** Fire every pending rAF callback `times` times, 17 virtual ms apart. */
function runFrames(times: number): void {
  for (let i = 0; i < times; i += 1) {
    rafState.now += 17;
    const batch = [...rafState.pending.entries()];
    for (const [id, cb] of batch) {
      rafState.pending.delete(id);
      cb(rafState.now);
    }
  }
}

function captureWarnings(fn: () => void): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

// ── test sketch module ───────────────────────────────────────────────

const decl = {
  speed: { type: "number", min: 0, max: 5, default: 1 },
  glow: { type: "boolean", default: true },
  tone: { type: "select", options: ["sky", "ember"], default: "sky" },
  reset: { type: "trigger" },
} as const satisfies ParamsDecl;

function makeModule(): { module: Record<string, unknown>; counters: { draws: number } } {
  const counters = { draws: 0 };
  const module = {
    params: decl,
    canvas: { width: 120, height: 90 },
    init: () => ({ t: 0 }),
    update: (model: unknown) => model,
    draw: () => {
      counters.draws += 1;
    },
  };
  return { module, counters };
}

// ── tests ────────────────────────────────────────────────────────────

test("mountSketch mounts a canvas + generated panel and runs the loop", () => {
  const mount = new FakeElement("div");
  const { module, counters } = makeModule();
  const teardown = mountSketch(asHTMLElement(mount), { module });

  const container = mount.children[0];
  assert.ok(container !== undefined && container.className === "cl-figure", "a .cl-figure container is appended");
  const canvas = container.find((el) => el.tagName === "canvas");
  assert.ok(canvas !== null, "a canvas is created");
  assert.equal(canvas.width, 120, "canvas width comes from module.canvas");
  assert.equal(canvas.height, 90, "canvas height comes from module.canvas");
  assert.ok(counters.draws >= 1, "frame 0 is drawn at mount");

  const panel = container.find((el) => el.className === "cl-params");
  assert.ok(panel !== null, "params panel renders by default when the module declares params");
  const slider = panel.find((el) => el.type === "range");
  assert.equal(slider?.value, "1", "number control shows the declared default");
  assert.ok(panel.find((el) => el.tagName === "select") !== null, "select control renders");
  assert.ok(panel.find((el) => el.className === "cl-trigger-btn") !== null, "trigger control renders");
  assert.equal(container.find((el) => el.className === "cl-toolbar"), null, "no transport toolbar by default");

  const before = counters.draws;
  runFrames(4);
  assert.ok(counters.draws > before, "the rAF loop advances frames");
  teardown();
});

test("transport toolbar renders on request; panel:false suppresses controls", () => {
  const mount = new FakeElement("div");
  const { module } = makeModule();
  const teardown = mountSketch(asHTMLElement(mount), { module, transport: true, panel: false });

  const container = mount.children[0];
  assert.ok(container !== undefined, "container mounted");
  assert.equal(container.find((el) => el.className === "cl-params"), null, "panel suppressed");
  const toolbar = container.find((el) => el.className === "cl-toolbar");
  assert.ok(toolbar !== null, "transport toolbar renders");
  const playPause = toolbar.find((el) => el.tagName === "button" && (el.textContent === "Pause" || el.textContent === "Play"));
  assert.equal(playPause?.textContent, "Pause", "autoplay default shows Pause");
  playPause?.click();
  assert.equal(playPause?.textContent, "Play", "clicking toggles to Play (paused)");
  teardown();
});

test("a non-TEA module throws a typed error and mounts nothing", () => {
  const mount = new FakeElement("div");
  assert.throws(
    () => mountSketch(asHTMLElement(mount), { module: 42 }),
    (e: unknown) => e instanceof Error && e.name === "SketchMountError",
    "a non-object module is a SketchMountError",
  );
  assert.throws(
    () => mountSketch(asHTMLElement(mount), { module: { params: decl } }),
    (e: unknown) => e instanceof Error && e.name === "CliError" && e.message.includes("must export init"),
    "a module without init/update/draw fails the shared TEA validator",
  );
  assert.equal(mount.children.length, 0, "nothing is left mounted after a throw");
});

test("initialParams: unknown keys and type mismatches warn and fall back to defaults", () => {
  const mount = new FakeElement("div");
  const { module } = makeModule();
  let teardown: () => void = () => {
    // replaced by the real teardown inside captureWarnings below
  };
  const warnings = captureWarnings(() => {
    teardown = mountSketch(asHTMLElement(mount), {
      module,
      initialParams: { speed: 3, bogus: 1, tone: "nope", glow: "yes" },
    });
  });
  assert.equal(warnings.length, 3, "one warning per rejected override (bogus, tone, glow)");
  assert.ok(warnings.some((w) => w.includes('"bogus"')), "unknown name is named");
  assert.ok(warnings.some((w) => w.includes('"tone"')), "out-of-options select value is named");
  assert.ok(warnings.some((w) => w.includes('"glow"')), "type-mismatched boolean is named");

  const container = mount.children[0];
  const slider = container?.find((el) => el.type === "range");
  assert.equal(slider?.value, "3", "the valid override applies");
  const checkbox = container?.find((el) => el.type === "checkbox");
  assert.equal(checkbox?.checked, true, "rejected boolean override falls back to its declared default");
  teardown();
});

test("sanitizeInitialParams rejects values aimed at trigger params", () => {
  const warnings = captureWarnings(() => {
    const out = sanitizeInitialParams({ decl, overrides: { reset: 1 } });
    assert.deepEqual(out, {}, "a trigger cannot hold a value");
  });
  assert.equal(warnings.length, 1, "the rejected trigger override warns");
});

test("teardown cancels the rAF loop, removes listeners, and unmounts the DOM", () => {
  const mount = new FakeElement("div");
  const { module } = makeModule();
  const teardown = mountSketch(asHTMLElement(mount), { module });
  runFrames(1);
  const container = mount.children[0];
  const canvas = container?.find((el) => el.tagName === "canvas");
  assert.ok(canvas !== null && canvas !== undefined, "canvas present before teardown");
  assert.ok(rafState.pending.size > 0, "the loop has a pending frame before teardown");
  assert.equal(canvas.addedListeners, 6, "input wiring attached its listeners");

  teardown();
  assert.equal(rafState.pending.size, 0, "teardown cancels the pending animation frame");
  assert.equal(canvas.removedListeners, 6, "teardown removes every input listener");
  assert.equal(mount.children.length, 0, "teardown removes the container from the mount");
});

test("the headless loader ignores a default export (dual-export entries)", () => {
  const { module } = makeModule();
  const dual = { ...module, default: (): null => null };
  assert.equal(isTeaModule(dual), true, "TEA detection keys on the named update export");
  const loaded = toTeaModule(dual);
  assert.equal(typeof loaded.update, "function", "the named exports load normally");
  assert.equal("default" in loaded, false, "the loaded module carries no default export");
});
