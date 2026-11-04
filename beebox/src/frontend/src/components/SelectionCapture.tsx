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
import { extractPointSelection, pointTarget, type ExtractedSelection } from "../lib/selection/position";

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
  kind: "text" | "point";
}

interface PendingPoint { element: Element; text: string; position: string }

interface SelectionCaptureProps {
  onCapture: (selection: { text: string; position: string }) => void;
  /** Computes text + locator: `extractSelection` for documents, `extractTranscriptSelection` for the chat. */
  extract: (selection: Selection, container: Element) => ExtractedSelection | null;
  children: ReactNode;
  className?: string;
  /** A tap chooses a block; the existing + still confirms attachment. */
  pointMode?: boolean;
  onExitPointMode?: () => void;
  /** Forwarded to the wrapper, so the wrapper itself can be the `bbx chat ui` scan boundary. */
  "data-bbx-scan"?: "exclude";
}

function pointIsVisible(target: Element): boolean {
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  let left = 0;
  let top = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;
  for (let ancestor = target.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
      const bounds = ancestor.getBoundingClientRect();
      left = Math.max(left, bounds.left);
      top = Math.max(top, bounds.top);
      right = Math.min(right, bounds.right);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  return rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
}

function validPoint({ button, point, container }: { button: FloatingButton; point: PendingPoint | null; container: Element | null }): boolean {
  if (point === null || container === null || !container.contains(point.element) || !pointIsVisible(point.element)) return false;
  const current = extractPointSelection(point.element, container);
  return current !== null && current.text === button.text && current.position === button.position;
}

function usePointSelection({ containerRef, pointMode, onExitPointMode, setButton }: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  pointMode: boolean;
  onExitPointMode: (() => void) | undefined;
  setButton: React.Dispatch<React.SetStateAction<FloatingButton | null>>;
}) {
  const [point, setPoint] = useState<PendingPoint | null>(null);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [outline, setOutline] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const syncPoint = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    const target = hovered ?? point?.element ?? null;
    const rect = target !== null && container.contains(target) && pointIsVisible(target) ? target.getBoundingClientRect() : null;
    setOutline(rect !== null && rect.width > 0 && rect.height > 0
      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      : null);
    if (point !== null) {
      if (!container.contains(point.element)) {
        setPoint(null);
        setButton(null);
        return;
      }
      if (!pointIsVisible(point.element)) {
        setButton(null);
        return;
      }
      const pointRect = point.element.getBoundingClientRect();
      setButton({ left: pointRect.right, top: pointRect.top, text: point.text, position: point.position, kind: "point" });
    }
  }, [containerRef, hovered, point, setButton]);

  useEffect(() => {
    if (pointMode) {
      setButton(null);
      window.getSelection()?.removeAllRanges();
    } else {
      setPoint(null);
      setHovered(null);
      setOutline(null);
      setButton((current) => current?.kind === "point" ? null : current);
    }
  }, [pointMode, setButton]);

  useEffect(() => {
    if (pointMode) syncPoint();
  }, [pointMode, syncPoint]);

  useEffect(() => {
    if (!pointMode) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (point !== null) {
        setPoint(null);
        setButton(null);
      } else {
        onExitPointMode?.();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [pointMode, point, onExitPointMode, setButton]);
  return { point, setPoint, hovered, setHovered, outline, setOutline, syncPoint };
}

export function SelectionCapture({ onCapture, extract, children, className, pointMode: pointModeProp, onExitPointMode, "data-bbx-scan": scan }: SelectionCaptureProps) {
  const pointMode = pointModeProp === true;
  const containerRef = useRef<HTMLDivElement>(null);
  const [button, setButton] = useState<FloatingButton | null>(null);
  const { point, setPoint, setHovered, outline, setOutline, syncPoint } = usePointSelection({ containerRef, pointMode, onExitPointMode, setButton });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    captureRoots.add(container);
    return () => { captureRoots.delete(container); };
  }, []);

  const refresh = useCallback(() => {
    if (pointMode) {
      syncPoint();
      return;
    }
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
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      setButton(null);
      return;
    }
    setButton({ left: rect.right, top: rect.top, text: extracted.text, position: extracted.position, kind: "text" });
  }, [extract, pointMode, syncPoint]);

  useEffect(() => {
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refresh);
    };
    // Scroll does not bubble: capture catches scrolling in either pane as
    // well as the document. Remeasure the range, not the old button position.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [refresh]);

  const handleClick = useCallback(() => {
    if (button === null) return;
    if (button.kind === "point" && !validPoint({ button, point, container: containerRef.current })) {
      setButton(null); setPoint(null);
      return;
    }
    onCapture({ text: button.text, position: button.position });
    setButton(null);
    setPoint(null);
    setOutline(null);
    const selection = window.getSelection();
    if (selection !== null) {
      selection.removeAllRanges();
    }
  }, [button, onCapture, point, setPoint, setOutline]);

  // Run refresh on the next task, not synchronously on mouseup. Clicking
  // inside an existing selection keeps that selection alive through mouseup
  // (drag affordance) and only collapses it on the following click — a
  // synchronous refresh would read the still-present selection and wrongly
  // re-show the "+". Deferring lets the collapse settle first.
  const scheduleRefresh = useCallback(() => {
    if (pointMode) return;
    window.setTimeout(refresh, 0);
  }, [pointMode, refresh]);

  const choosePoint = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!pointMode || (event.target instanceof Element && event.target.closest("#bbx-selection-add") !== null)) return;
    const container = containerRef.current;
    if (container === null) return;
    event.preventDefault();
    event.stopPropagation();
    const target = pointTarget(event.target, container);
    const extracted = target === null ? null : extractPointSelection(target, container);
    if (target === null || extracted === null) {
      setPoint(null);
      setButton(null);
      return;
    }
    window.getSelection()?.removeAllRanges();
    setPoint({ element: target, ...extracted });
    setHovered(null);
    const rect = target.getBoundingClientRect();
    setButton({ left: rect.right, top: rect.top, text: extracted.text, position: extracted.position, kind: "point" });
  }, [pointMode, setPoint, setHovered]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-bbx-scan={scan}
      // This wrapper carries no semantics of its own — it's instrumentation
      // over arbitrary `children` content, not a widget — so `role="none"`
      // is accurate, not a workaround: it has no accessible role to strip.
      role="none"
      style={pointMode ? { userSelect: "none" } : undefined}
      onClickCapture={choosePoint}
      onContextMenuCapture={(event) => { if (pointMode) event.preventDefault(); }}
      onPointerMove={(event) => {
        if (!pointMode || event.pointerType !== "mouse") return;
        if (event.target instanceof Element && event.target.closest("#bbx-selection-add") !== null) {
          setHovered(null);
          return;
        }
        const container = containerRef.current;
        if (container === null) return;
        const target = pointTarget(event.target, container);
        setHovered(target !== null && extractPointSelection(target, container) !== null ? target : null);
      }}
      onPointerLeave={() => { if (pointMode) setHovered(null); }}
      onMouseUp={(event) => { event.stopPropagation(); scheduleRefresh(); }}
      onMouseDown={() => { setButton(null); if (pointMode) setPoint(null); }}
      // Keyboard equivalents of the mouse handlers above — a keyboard user
      // extending a text selection (Shift+Arrow) fires keyup on the focused
      // descendant, which bubbles here, so this genuinely detects
      // keyboard-driven selections rather than just satisfying the linter.
      onKeyUp={(event) => { event.stopPropagation(); scheduleRefresh(); }}
      onKeyDown={(event) => { if (!pointMode && event.target !== event.currentTarget.querySelector("#bbx-selection-add")) setButton(null); }}
    >
      {children}
      {pointMode && outline !== null ? (
        <div aria-hidden className="pointer-events-none fixed z-40 rounded-sm border-2 border-accent bg-accent/10"
          style={outline} />
      ) : null}
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
          style={{
            position: "fixed",
            left: `clamp(8px, ${button.left + 6}px, calc(100% - 1.75rem - 8px))`,
            top: `clamp(8px, ${button.top - 6}px, calc(100% - 1.75rem - 8px))`,
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  );
}
