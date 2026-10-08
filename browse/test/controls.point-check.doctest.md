# The covered check for a `@eN` ref with no id

A ref whose element carries no `bbx-` id is checked at the centre of the box
upstream reports for it. In the 2026-10-08 C-reconnecting walk a todo checkbox
sat under the full-width conversation layer; `bin/browse click @ref` printed
`✓ Done` and the app saw nothing
(`issues/closed/bugs/2026-10-08-browse-ref-click-checks-only-geometry.md`).
The old check compared the snapshot's name with the text of the topmost
element, so a covering container whose text held the name passed, and a ref
with no name was not checked at all.

The check now finds the ref's element among the elements stacked at the point,
by its box, and requires the topmost element to be that element, inside it, or
its `<label>`.

These examples run `checkScript` against a stand-in DOM: elements with fixed
boxes, painted in a fixed order, and `document.elementsFromPoint` answering from
that order.

```ts setup
import assert from "node:assert/strict";
import vm from "node:vm";
import { checkScript, type Box } from "../src/controls.js";

class StubNode { static TEXT_NODE = 3; }

interface Spec { id?: string; box: Box; text?: string; attrs?: Record<string, string>; pointerEvents?: string }

class StubElement extends StubNode {
  readonly nodeType = 1;
  readonly isConnected = true;
  readonly disabled = false;
  readonly tagName: string;
  readonly id: string;
  readonly box: Box;
  readonly attrs: Record<string, string>;
  readonly pointerEvents: string;
  parentElement: StubElement | null = null;
  childNodes: (StubElement | { nodeType: number; nodeValue: string })[] = [];
  labels: StubElement[] | null = null;
  constructor(tag: string, spec: Spec) {
    super();
    this.tagName = tag.toUpperCase();
    this.id = spec.id ?? "";
    this.box = spec.box;
    this.attrs = spec.attrs ?? {};
    this.pointerEvents = spec.pointerEvents ?? "auto";
    if (spec.text !== undefined) this.childNodes.push({ nodeType: 3, nodeValue: spec.text });
  }
  append(...kids: StubElement[]): this {
    for (const k of kids) { k.parentElement = this; this.childNodes.push(k); }
    return this;
  }
  get textContent(): string {
    return this.childNodes.map((c) => (c instanceof StubElement ? c.textContent : c.nodeValue)).join("");
  }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
  getBoundingClientRect() {
    const { x, y, width, height } = this.box;
    return { left: x, top: y, right: x + width, bottom: y + height, width, height };
  }
  contains(n: StubElement | null): boolean {
    for (let e = n; e !== null; e = e.parentElement) if (e === this) return true;
    return false;
  }
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const role = /^\[role="(.+)"\]$/.exec(part);
      if (role !== null) return this.attrs.role === role[1];
      if (part === "a[href]") return this.tagName === "A" && "href" in this.attrs;
      return this.tagName === part.toUpperCase();
    });
  }
  closest(selector: string): StubElement | null {
    for (let e: StubElement | null = this; e !== null; e = e.parentElement) if (e.matches(selector)) return e;
    return null;
  }
  checkVisibility(): boolean { return true; }
  scrollIntoView(): void { /* every stand-in box is on screen */ }
}

class StubInput extends StubElement {}

const el = (tag: string, spec: Spec): StubElement => new StubElement(tag, spec);
const input = (spec: Spec): StubInput => new StubInput("input", spec);

/** Runs the check with `paint` as the stacking order, topmost first. */
function check(paint: StubElement[], { box, expectName }: { box: Box; expectName: string | null }): unknown {
  const inside = (e: StubElement, x: number, y: number): boolean =>
    x >= e.box.x && x < e.box.x + e.box.width && y >= e.box.y && y < e.box.y + e.box.height;
  const document = {
    elementsFromPoint: (x: number, y: number) => paint.filter((e) => e.pointerEvents !== "none" && inside(e, x, y)),
    elementFromPoint: (x: number, y: number) => paint.find((e) => e.pointerEvents !== "none" && inside(e, x, y)) ?? null,
    getElementById: (id: string) => paint.find((e) => e.id === id) ?? null,
  };
  const context = vm.createContext({
    document, Node: StubNode, Element: StubElement, HTMLInputElement: StubInput,
    getComputedStyle: (e: StubElement) => ({ display: "inline", pointerEvents: e.pointerEvents }),
    innerWidth: 1280, innerHeight: 800, JSON, Math, Array, Set, String,
  });
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const printed: unknown = vm.runInContext(checkScript({ kind: "point", x, y, box, expectName }), context);
  assert.equal(typeof printed, "string");
  return JSON.parse(String(printed));
}

const CHECKBOX_BOX = { x: 40, y: 520, width: 16, height: 16 };
const DESK_BOX = { x: 0, y: 400, width: 1280, height: 400 };
```

## A control under a full-width layer is covered, named or not

The reported case: the checkbox's snapshot name is "Open", and the layer over
it contains the word "Open". The old substring match passed this click.

```ts
const box = el("li", { box: { x: 30, y: 510, width: 600, height: 36 } });
const checkbox = input({ box: CHECKBOX_BOX, attrs: { role: "checkbox", "aria-label": "Open" } });
box.append(checkbox);
const desk = el("div", { box: DESK_BOX, text: "Open the conversation to reply" });
const paint = [desk, checkbox, box];

check(paint, { box: CHECKBOX_BOX, expectName: "Open" })
=> { ok: false, reason: "covered", detail: "the ref's element input[role=checkbox] \"Open\" is under div \"Open the conversation to reply\"" }

check(paint, { box: CHECKBOX_BOX, expectName: null })
=> { ok: false, reason: "covered", detail: "the ref's element input[role=checkbox] \"Open\" is under div \"Open the conversation to reply\"" }
```

With the layer gone the same click passes.

```ts
const checkbox = input({ box: CHECKBOX_BOX, attrs: { role: "checkbox", "aria-label": "Open" } });

check([checkbox], { box: CHECKBOX_BOX, expectName: "Open" })
=> { ok: true, scrolled: false }
```

## The topmost element may be inside the control or its label

A button's visible text is a child `<span>`, so the span is what the point
hits. A custom checkbox draws a `<span>` over its input inside a wrapping
`<label>`; the span belongs to the input's own label. Neither is covered.

```ts
const BUTTON_BOX = { x: 100, y: 100, width: 80, height: 30 };
const button = el("button", { box: BUTTON_BOX });
const caption = el("span", { box: { x: 110, y: 105, width: 60, height: 20 }, text: "Send" });
button.append(caption);

check([caption, button], { box: BUTTON_BOX, expectName: "Send" })
=> { ok: true, scrolled: false }
```

```ts
const label = el("label", { box: { x: 30, y: 510, width: 300, height: 36 } });
const box = input({ box: CHECKBOX_BOX, attrs: { type: "checkbox" } });
const mark = el("span", { box: { x: 38, y: 518, width: 20, height: 20 } });
const words = el("span", { box: { x: 60, y: 515, width: 200, height: 20 }, text: "Return the drill" });
label.append(box, mark, words);
box.labels = [label];

check([mark, box, label], { box: CHECKBOX_BOX, expectName: "Return the drill" })
=> { ok: true, scrolled: false }
```

A `<label>` that belongs to another control is not an exception.

```ts
const other = el("label", { box: DESK_BOX, text: "Return the drill" });
const box = input({ box: CHECKBOX_BOX, attrs: { type: "checkbox" } });
box.labels = [];

check([other, box], { box: CHECKBOX_BOX, expectName: "Return the drill" }).reason
=> covered
```

## A control that does not take the pointer falls back to its name

When no element at the point has the ref's box, the element cannot be found
there, so the topmost element must carry the snapshot's name, as before.

```ts
const label = el("label", { box: { x: 30, y: 510, width: 300, height: 36 }, text: "Return the drill" });
const hidden = input({ box: CHECKBOX_BOX, pointerEvents: "none" });
label.append(hidden);

check([hidden, label], { box: CHECKBOX_BOX, expectName: "Return the drill" })
=> { ok: true, scrolled: false }

check([hidden, label], { box: CHECKBOX_BOX, expectName: "Buy milk" }).reason
=> covered
```
