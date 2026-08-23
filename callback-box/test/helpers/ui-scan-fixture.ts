/**
 * Build a `ScanElement` tree from an HTML fixture, for the `ui-scan` doctests.
 *
 * The frontend doctests run under plain Node with no jsdom, which is why
 * `ui-scan` walks the structural {@link ScanElement} view rather than `Element`
 * (see `src/frontend/src/lib/ui-scan/types.ts`). This helper is the test-side
 * counterpart of `live-dom.ts`: cheerio — already a dependency — parses the
 * markup, and two test-only attributes supply the two things a parser cannot
 * know, because in the real browser they come from CSS and layout:
 *
 * - `data-test-style="display:none; opacity:0"` → the element's computed style
 * - `data-test-rect="left,top,width,height"` → its border box in viewport
 *   coordinates; the default is a small on-screen box
 *
 * Everything else is the app's real markup, copied from the components.
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { invariant } from "../../src/lib/invariant.js";
import type { ScanElement, ScanNode, ScanRect, ScanStyle } from "../../src/frontend/src/lib/ui-scan/types.js";

/** The parsed-node union, reached through cheerio's own API so `domhandler`
 *  (a transitive dependency) is never imported by name. */
type ParsedNode = ReturnType<CheerioAPI["root"]>[number]["children"][number];

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
  if (node.type === "text") return { kind: "text", text: node.data };
  if (node.type !== "tag") return null;
  const attributes = node.attribs;
  const style = parseStyle(attributes["data-test-style"]);
  const rect = parseRect(attributes["data-test-rect"]);
  return {
    kind: "element",
    tag: node.name,
    attributes,
    children: node.children.flatMap((child) => {
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
  const $ = cheerio.load(`<div data-test-rect="0,0,1024,768">${html}</div>`, null, false);
  const wrapper = $.root()[0]?.children[0];
  invariant(wrapper !== undefined, "ui-scan fixture parsed to nothing");
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
