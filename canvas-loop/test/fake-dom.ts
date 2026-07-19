// Shared fake-DOM + fake-rAF harness for the browser mount tests. Importing
// this module installs `document`/`requestAnimationFrame`/`cancelAnimationFrame`
// fakes on globalThis — node --test runs each file in its own process, so the
// install can't leak into the SSR test's asserted-DOM-free environment.
import type { ParamsDecl } from "@ianbicking/canvas-loop";

// ── fake DOM ─────────────────────────────────────────────────────────

type Listener = (event: unknown) => void;

export class FakeElement {
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

export function asHTMLElement(el: FakeElement): HTMLElement {
  // eslint-disable-next-line no-restricted-syntax -- test boundary: the fake element stands in for the DOM element mount code duck-types against
  return el as unknown as HTMLElement;
}

export function asHTMLCanvas(el: FakeElement): HTMLCanvasElement {
  // eslint-disable-next-line no-restricted-syntax -- test boundary: the fake element stands in for the canvas element attachSketch duck-types against
  return el as unknown as HTMLCanvasElement;
}

export const rafState: {
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
export function runFrames(times: number): void {
  for (let i = 0; i < times; i += 1) {
    rafState.now += 17;
    const batch = [...rafState.pending.entries()];
    for (const [id, cb] of batch) {
      rafState.pending.delete(id);
      cb(rafState.now);
    }
  }
}

export function captureWarnings(fn: () => void): string[] {
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

export const decl = {
  speed: { type: "number", min: 0, max: 5, default: 1 },
  glow: { type: "boolean", default: true },
  tone: { type: "select", options: ["sky", "ember"], default: "sky" },
  reset: { type: "trigger" },
} as const satisfies ParamsDecl;

export function makeModule(): { module: Record<string, unknown>; counters: { draws: number } } {
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
