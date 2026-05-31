/**
 * Wraps a rendered document and surfaces a floating "+" near a text
 * selection; clicking it hands the selection (verbatim text + a rough
 * position locator) to `onCapture`. Used in the chat companion pane so the
 * user can attach document text to a chat message.
 *
 * Geometry (where the "+" sits) lives here and nowhere else: it reads the
 * selection's bounding rect and positions the button with `fixed` so it
 * lands correctly even inside a scrolling pane. The locator computation is
 * delegated to `extractSelection`, which touches only the DOM tree.
 */

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { extractSelection } from "../lib/selection-position";

interface FloatingButton {
  left: number;
  top: number;
  text: string;
  position: string;
}

interface SelectionCaptureProps {
  onCapture: (selection: { text: string; position: string }) => void;
  children: ReactNode;
}

export function SelectionCapture({ onCapture, children }: SelectionCaptureProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [button, setButton] = useState<FloatingButton | null>(null);

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
    if (!container.contains(range.commonAncestorContainer)) {
      setButton(null);
      return;
    }
    const extracted = extractSelection(selection, container);
    if (extracted === null) {
      setButton(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setButton({ left: rect.right, top: rect.top, text: extracted.text, position: extracted.position });
  }, []);

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

  return (
    <div ref={containerRef} onMouseUp={refresh} onMouseDown={() => setButton(null)}>
      {children}
      {button === null ? null : (
        <button
          type="button"
          aria-label="Add selection to message"
          title="Add selection to message"
          // Keep the selection alive — a plain click would collapse it before onClick.
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleClick}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-accent text-white shadow-md hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent z-50"
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
