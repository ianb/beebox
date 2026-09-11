/**
 * Wraps a rendered document and surfaces a floating "+" near a text
 * selection; clicking it hands the selection (verbatim text + a rough
 * position locator) to `onCapture`. Used in the chat companion pane so the
 * user can attach document text to a chat message, and over the chat
 * transcript so they can quote a message back.
 *
 * Geometry (where the "+" sits) lives here and nowhere else: it reads the
 * selection's bounding rect and positions the button with `fixed` so it
 * lands correctly even inside a scrolling pane. The locator computation is
 * delegated to `extractSelection`, which touches only the DOM tree.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ExtractedSelection } from "../lib/selection/position";

// Mounted capture roots. Captures nest — a card embedded in a chat message
// sits inside the transcript's capture — and the innermost root containing
// the selection owns it, so exactly one "+" appears, carrying that source.
const captureRoots = new WeakSet<Element>();

function ownsSelection(container: Element, node: Node): boolean {
  let el: Element | null = node instanceof Element ? node : node.parentElement;
  while (el !== null && el !== container) {
    if (captureRoots.has(el)) return false;
    el = el.parentElement;
  }
  return el === container;
}

interface FloatingButton {
  left: number;
  top: number;
  text: string;
  position: string;
}

interface SelectionCaptureProps {
  onCapture: (selection: { text: string; position: string }) => void;
  /** Computes text + locator: `extractSelection` for documents, `extractTranscriptSelection` for the chat. */
  extract: (selection: Selection, container: Element) => ExtractedSelection | null;
  children: ReactNode;
  className?: string;
  /** Forwarded to the wrapper, so the wrapper itself can be the `bbx chat ui` scan boundary. */
  "data-bbx-scan"?: "exclude";
}

export function SelectionCapture({ onCapture, extract, children, className, "data-bbx-scan": scan }: SelectionCaptureProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [button, setButton] = useState<FloatingButton | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    captureRoots.add(container);
    return () => { captureRoots.delete(container); };
  }, []);

  const refresh = useCallback(() => {
    const container = containerRef.current;
    if (container === null) {
      setButton(null);
      return;
    }
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) {
      setButton(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!ownsSelection(container, range.commonAncestorContainer)) {
      setButton(null);
      return;
    }
    const extracted = extract(selection, container);
    if (extracted === null) {
      setButton(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setButton({ left: rect.right, top: rect.top, text: extracted.text, position: extracted.position });
  }, [extract]);

  const handleClick = useCallback(() => {
    if (button === null) {
      return;
    }
    onCapture({ text: button.text, position: button.position });
    setButton(null);
    const selection = window.getSelection();
    if (selection !== null) {
      selection.removeAllRanges();
    }
  }, [button, onCapture]);

  // Run refresh on the next task, not synchronously on mouseup. Clicking
  // inside an existing selection keeps that selection alive through mouseup
  // (drag affordance) and only collapses it on the following click — a
  // synchronous refresh would read the still-present selection and wrongly
  // re-show the "+". Deferring lets the collapse settle first.
  const scheduleRefresh = useCallback(() => {
    window.setTimeout(refresh, 0);
  }, [refresh]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-bbx-scan={scan}
      // This wrapper carries no semantics of its own — it's instrumentation
      // over arbitrary `children` content, not a widget — so `role="none"`
      // is accurate, not a workaround: it has no accessible role to strip.
      role="none"
      onMouseUp={(event) => { event.stopPropagation(); scheduleRefresh(); }}
      onMouseDown={() => setButton(null)}
      // Keyboard equivalents of the mouse handlers above — a keyboard user
      // extending a text selection (Shift+Arrow) fires keyup on the focused
      // descendant, which bubbles here, so this genuinely detects
      // keyboard-driven selections rather than just satisfying the linter.
      onKeyUp={(event) => { event.stopPropagation(); scheduleRefresh(); }}
      onKeyDown={() => setButton(null)}
    >
      {children}
      {button === null ? null : (
        <button
          id="bbx-selection-add"
          type="button"
          aria-label="Add selection to message"
          title="Add selection to message"
          // preventDefault keeps the selection alive (a plain click collapses
          // it); stopPropagation keeps this mousedown from reaching the
          // container's onMouseDown, which would dismiss the button before the
          // click fires. Same for mouseup vs the container's refresh.
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={handleClick}
          className="bbx-system-control flex items-center justify-center w-7 h-7 rounded-full bg-accent text-white shadow-md hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent z-50"
          style={{ position: "fixed", left: button.left + 6, top: button.top - 6 }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  );
}
