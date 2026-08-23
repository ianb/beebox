/**
 * The real-DOM adapter: the one place `ui-scan` touches browser globals.
 *
 * Everything else in this directory walks {@link ScanElement}, a structural view
 * of an element, so the walk and the name computation are exercised by doctests
 * under plain Node. This module is the thin lazy wrapper that makes the live
 * document satisfy that view — attributes eagerly (cheap), children and computed
 * style through getters, so a subtree the walk prunes is never converted and
 * `getComputedStyle` is never called for it.
 */

import { scanControls } from "./scan.js";
import type { ScanElement, ScanNode, ScanResult } from "./types.js";

function attributesOf(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    attributes[attribute.name.toLowerCase()] = attribute.value;
  }
  return attributes;
}

/** Wrap one live element (and, lazily, its subtree) as a {@link ScanElement}. */
export function domScanElement(element: Element): ScanElement {
  return {
    kind: "element",
    tag: element.tagName.toLowerCase(),
    attributes: attributesOf(element),
    get children(): readonly ScanNode[] {
      const nodes: ScanNode[] = [];
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE && child instanceof Element) {
          nodes.push(domScanElement(child));
        } else if (child.nodeType === Node.TEXT_NODE) {
          nodes.push({ kind: "text", text: child.textContent ?? "" });
        }
      }
      return nodes;
    },
    style: () => {
      const computed = window.getComputedStyle(element);
      return {
        display: computed.display,
        visibility: computed.visibility,
        opacity: computed.opacity,
      };
    },
    rect: () => {
      const box = element.getBoundingClientRect();
      return { top: box.top, left: box.left, width: box.width, height: box.height };
    },
  };
}

/** Scan what is on screen right now, from `document.body` down. */
export function scanLiveDocument(): ScanResult {
  return scanControls(domScanElement(document.body), {
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
}
