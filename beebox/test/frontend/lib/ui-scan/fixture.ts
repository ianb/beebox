/**
 * Build a `ScanElement` tree from an HTML fixture, for the `ui-scan` tests.
 *
 * The frontend tests run under plain Node with no jsdom, which is why
 * `ui-scan` walks the structural {@link ScanElement} view rather than `Element`
 * (see `src/frontend/src/lib/ui-scan/types.ts`). This helper is the test-side
 * counterpart of `live-dom.ts`: happy-dom — the frontend's test DOM — parses
 * the markup (as a parser only; no globals are registered), and two test-only
 * attributes supply the two things a parser cannot
 * know, because in the real browser they come from CSS and layout:
 *
 * - `data-test-style="display:none; opacity:0"` → the element's computed style
 * - `data-test-rect="left,top,width,height"` → its border box in viewport
 *   coordinates; the default is a small on-screen box
 *
 * Everything else is the app's real markup, copied from the components.
 */

import { Element, Text, Window, type Node as ParsedNode } from "happy-dom";
import { invariant } from "../../../../src/shared/invariant.js";
import type { VisibleElementLookup } from "../../../../src/frontend/src/lib/ui-scan/resolve.js";
import type { ScanElement, ScanNode, ScanRect, ScanStyle } from "../../../../src/frontend/src/lib/ui-scan/types.js";
import { isNodeVisible, type VisibilityNode } from "../../../../src/frontend/src/lib/ui-scan/live-dom/visibility.js";

const DEFAULT_STYLE: ScanStyle = { display: "block", visibility: "visible", opacity: "1" };
const DEFAULT_RECT: ScanRect = { left: 0, top: 0, width: 120, height: 32 };

function parseStyle(value: string | undefined): ScanStyle {
  if (value === undefined) return DEFAULT_STYLE;
  const style = { ...DEFAULT_STYLE };
  for (const declaration of value.split(";")) {
    const [property, setting] = declaration.split(":");
    if (property === undefined || setting === undefined) continue;
    const name = property.trim();
    if (name === "display") style.display = setting.trim();
    if (name === "visibility") style.visibility = setting.trim();
    if (name === "opacity") style.opacity = setting.trim();
  }
  return style;
}

function parseRect(value: string | undefined): ScanRect {
  if (value === undefined) return DEFAULT_RECT;
  const [left, top, width, height] = value.split(",").map((part) => Number(part.trim()));
  return {
    left: left ?? 0,
    top: top ?? 0,
    width: width ?? 0,
    height: height ?? 0,
  };
}

function toScanNode(node: ParsedNode): ScanNode | null {
  if (node instanceof Text) return { kind: "text", text: node.data };
  if (!(node instanceof Element)) return null;
  const element = node;
  const attributes: Record<string, string> = {};
  for (const name of element.getAttributeNames()) attributes[name] = element.getAttribute(name) ?? "";
  const style = parseStyle(attributes["data-test-style"]);
  const rect = parseRect(attributes["data-test-rect"]);
  return {
    kind: "element",
    tag: element.localName,
    attributes,
    children: Array.from(node.childNodes).flatMap((child) => {
      const scanned = toScanNode(child);
      return scanned === null ? [] : [scanned];
    }),
    style: () => style,
    rect: () => rect,
  };
}

/**
 * Parse an HTML fragment and return the element wrapping it — a `<div>` that is
 * neither a control nor a landmark, so it never appears in a scan itself.
 */
export function fixtureRoot(html: string): ScanElement {
  const document = new Window().document;
  const host = document.createElement("div");
  host.innerHTML = `<div data-test-rect="0,0,1024,768">${html}</div>`;
  const wrapper = host.firstChild;
  invariant(wrapper !== null, "ui-scan fixture parsed to nothing");
  const parsed = toScanNode(wrapper);
  invariant(parsed !== null && parsed.kind === "element", "ui-scan fixture root is not an element");
  return parsed;
}

/** The first element inside a fixture — the one an accname example is about. */
export function fixtureElement(html: string): ScanElement {
  const root = fixtureRoot(html);
  const element = root.children.find((child) => child.kind === "element");
  invariant(element !== undefined && element.kind === "element", "ui-scan fixture has no element");
  return element;
}

/**
 * A fixture standing in for the live `document` at a `control:` pointer's
 * resolution: `getElementById` over the same markup the scan walks, plus the
 * visibility rule `live-dom.ts` supplies in the browser.
 *
 * Resolution needs the way *up* — an element is hidden when any ancestor hides
 * it — which the walk never does, so the parsed tree is re-linked here with
 * parent pointers rather than `ScanElement` growing one.
 */
export type VisibleFixtureLookup = VisibleElementLookup<VisibilityNode>;

export function fixtureLookup(html: string): VisibleFixtureLookup {
  const byId = new Map<string, VisibilityNode>();
  function link(element: ScanElement, parent: VisibilityNode | null): void {
    const node: VisibilityNode = {
      attributes: element.attributes,
      style: element.style,
      rect: element.rect,
      parent: () => parent,
    };
    const id = element.attributes["id"];
    if (id !== undefined && !byId.has(id)) byId.set(id, node);
    for (const child of element.children) if (child.kind === "element") link(child, node);
  }
  link(fixtureRoot(html), null);
  return {
    getElementById: (id: string) => byId.get(id) ?? null,
    isVisible: isNodeVisible,
  };
}
