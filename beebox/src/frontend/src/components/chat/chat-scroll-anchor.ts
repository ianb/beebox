/** A stable point in rendered transcript content, used to measure reflow. */
export interface Anchor {
  point: AnchorPoint;
  top: number;
}

type AnchorPoint =
  | { kind: "text"; node: Text; start: number; end: number; prefix: string }
  | { kind: "element"; element: Element };

function visibleRect(rects: DOMRectList | DOMRect[], viewport: { top: number; bottom: number }): DOMRect | null {
  for (const rect of Array.from(rects)) {
    if (rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom) return rect;
  }
  return null;
}

function textPoint(node: Text, viewport: { top: number; bottom: number }): AnchorPoint | null {
  if (node.length === 0) return null;
  const range = document.createRange();

  // Find the first visible character by dividing the node. This also handles a
  // newline and the following line living in one Text node, without inserting
  // a marker into the transcript DOM.
  const find = (bounds: { start: number; end: number }): AnchorPoint | null => {
    const { start, end } = bounds;
    range.setStart(node, start);
    range.setEnd(node, end);
    if (!visibleRect(range.getClientRects(), viewport)) return null;
    if (end - start === 1) return { kind: "text", node, start, end, prefix: node.data.slice(0, end) };
    const middle = start + Math.floor((end - start) / 2);
    return find({ start, end: middle }) ?? find({ start: middle, end });
  };

  return find({ start: 0, end: node.length });
}

function visibleMessage(scroller: HTMLElement, content: HTMLElement): Element | null {
  const viewport = scroller.getBoundingClientRect();
  const messages = content.querySelectorAll(":scope > [data-role], :scope > * > [data-role]");
  for (const message of Array.from(messages)) {
    const rect = message.getBoundingClientRect();
    if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
    return message;
  }
  return null;
}

function pointRect(point: AnchorPoint): DOMRect | null {
  if (point.kind === "element") {
    return point.element.isConnected ? point.element.getBoundingClientRect() : null;
  }
  if (
    !point.node.isConnected
    || point.end > point.node.length
    || !point.node.data.startsWith(point.prefix)
  ) return null;
  const range = document.createRange();
  range.setStart(point.node, point.start);
  range.setEnd(point.node, point.end);
  return Array.from(range.getClientRects()).find((rect) => rect.height > 0) ?? null;
}

function contentTop(point: AnchorPoint, scroller: HTMLElement): number | null {
  const rect = pointRect(point);
  if (!rect || !scroller.isConnected) return null;
  return rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

/**
 * Capture visible text near the viewport top. Only the visible message's text
 * descendants are walked, so a long retained transcript is not rescanned.
 */
export function anchorChild(scroller: HTMLElement | null, content: HTMLElement | null): Anchor | null {
  if (!scroller || !content) return null;
  const message = visibleMessage(scroller, content);
  if (!message) return null;
  const viewport = scroller.getBoundingClientRect();
  const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (!(node instanceof Text)) return null;
    const point = textPoint(node, viewport);
    if (point) {
      const top = contentTop(point, scroller);
      if (top !== null) return { point, top };
    }
    node = walker.nextNode();
  }

  const point: AnchorPoint = { kind: "element", element: message };
  const top = contentTop(point, scroller);
  return top === null ? null : { point, top };
}

/** Read the anchor in scroll-content coordinates; scrolling alone cannot change it. */
export function anchorOffset(anchor: Anchor | null, scroller: HTMLElement): number | null {
  if (!anchor) return null;
  return contentTop(anchor.point, scroller);
}
