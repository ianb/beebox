/**
 * Shows selected text in each scope that can carry its own selection pair:
 * the chat, one's own message, a reply, a card in chat, the reading card, its
 * code block, and a plain file. A page has one selection, so the studio paints
 * these with a CSS highlight that themes/chrome.css styles as it styles
 * `::selection`. `bin/theme-check` measures each highlighted element's
 * `::selection` colors.
 */

import { useEffect, type RefObject } from "react";

export const SELECTION_PREVIEW = "bbx-selection-preview";

/** Where the preview selects, as selectors under the studio's scroller. */
const SCOPES = [
  ".bbx-conversation-desk",
  ".bbx-chat-user-paper",
  ".bbx-chat-reply-material .bbx-paragraph",
  ".bbx-conversation-desk .bbx-card-theme .bbx-paragraph",
  ".bbx-companion-desk .bbx-card-theme .bbx-paragraph",
  ".bbx-companion-desk .bbx-card-theme pre",
  ".bbx-companion-desk [data-card-content='neutral'] pre",
];

/** The first words of an element's first text long enough to show. */
function previewRange(root: Element): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.textContent ?? "").trim().length >= 8 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP });
  const text = walker.nextNode();
  if (text === null) return null;
  const content = text.textContent ?? "";
  const start = content.length - content.trimStart().length;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, Math.min(content.length, start + 24));
  return range;
}

/** Keeps the preview on the scroller's specimens as they render. */
export function useSelectionPreview(scroller: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = scroller.current;
    if (root === null || !("highlights" in CSS)) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const ranges = SCOPES.flatMap((selector) => {
        const el = root.querySelector(selector);
        const range = el === null ? null : previewRange(el);
        return range === null ? [] : [range];
      });
      CSS.highlights.set(SELECTION_PREVIEW, new Highlight(...ranges));
    };
    const observer = new MutationObserver(() => { if (frame === 0) frame = requestAnimationFrame(paint); });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    paint();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      CSS.highlights.delete(SELECTION_PREVIEW);
    };
  }, [scroller]);
}
