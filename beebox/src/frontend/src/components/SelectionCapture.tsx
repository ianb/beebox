import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { extractPointSelection, pointTarget, type ExtractedSelection } from "../lib/selection/position";

// Mounted capture roots. Captures nest — a card embedded in a chat message
// sits inside the transcript's capture — and the innermost root containing
// the selection owns it, so exactly one "+" appears, carrying that source.
const captureRoots = new WeakSet<Element>();
const pendingListeners = new Set<() => void>();
const pendingRoots = new Set<Element>();

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

interface PendingPoint { element: Element; text: string; position: string; offsetY: number }

interface SelectionCaptureProps {
  onCapture: (selection: { text: string; position: string }) => void;
  /** Each source supplies its own locator while sharing point geometry. */
  extractPoint?: (target: Element, container: Element) => ExtractedSelection | null;
  children: ReactNode;
  className?: string;
  /** A click attaches a block; a touch tap previews it for confirmation. */
  pointMode?: boolean;
  onExitPointMode?: () => void;
  /** Forwarded to the wrapper, so the wrapper itself can be the `bbx chat ui` scan boundary. */
  "data-bbx-scan"?: "exclude";
}

function pointIsVisible(target: Element): boolean {
  if (target.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false;
  const targetStyle = window.getComputedStyle(target);
  if (targetStyle.display === "none" || targetStyle.visibility === "hidden") return false;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  let left = 0;
  let top = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;
  for (let ancestor = target.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden") return false;
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

function usePointSelection({ containerRef, pointMode, onExitPointMode, setButton, onCapture, extractPoint }: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  pointMode: boolean;
  onExitPointMode: (() => void) | undefined;
  setButton: React.Dispatch<React.SetStateAction<FloatingButton | null>>;
  onCapture: SelectionCaptureProps["onCapture"];
  extractPoint: NonNullable<SelectionCaptureProps["extractPoint"]>;
}) {
  const [point, setPoint] = useState<PendingPoint | null>(null);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [outline, setOutline] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const pointerTypeRef = useRef<string | null>(null);

  const choosePoint = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!pointMode) return;
    const needsConfirmation = pointerTypeRef.current === "touch";
    pointerTypeRef.current = null;
    if (event.target instanceof Element && event.target.closest("#bbx-selection-add") !== null) return;
    const container = containerRef.current;
    if (container === null || !(event.target instanceof Node) || !ownsSelection(container, event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    for (const cancel of pendingListeners) cancel();
    const target = pointTarget(event.target, container);
    const extracted = target === null ? null : extractPoint(target, container);
    if (target === null || extracted === null) {
      setPoint(null);
      setButton(null);
      return;
    }
    window.getSelection()?.removeAllRanges();
    if (!needsConfirmation) {
      onCapture(extracted);
      setPoint(null);
      setHovered(null);
      setOutline(null);
      setButton(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    setPoint({ element: target, ...extracted, offsetY });
    setHovered(null);
    setButton({ left: rect.right, top: event.clientY, text: extracted.text, position: extracted.position });
  }, [containerRef, pointMode, onCapture, setButton, extractPoint]);

  const syncPoint = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    const target = hovered ?? point?.element ?? null;
    const rect = target !== null && container.contains(target) && pointIsVisible(target) ? target.getBoundingClientRect() : null;
    setOutline(rect !== null && rect.width > 0 && rect.height > 0
      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      : null);
    if (point !== null) {
      const current = extractPoint(point.element, container);
      if (!container.contains(point.element) || !pointIsVisible(point.element) || current?.text !== point.text || current.position !== point.position) {
        setPoint(null);
        setButton(null);
        return;
      }
      const pointRect = point.element.getBoundingClientRect();
      setButton({ left: pointRect.right, top: pointRect.top + point.offsetY, text: point.text, position: point.position });
    }
  }, [containerRef, hovered, point, setButton, extractPoint]);

  useEffect(() => {
    if (pointMode) {
      setButton(null);
      window.getSelection()?.removeAllRanges();
    } else {
      setPoint(null);
      setHovered(null);
      setOutline(null);
      setButton(null);
    }
  }, [pointMode, setButton]);

  useEffect(() => {
    if (pointMode) syncPoint();
  }, [pointMode, syncPoint]);

  useEffect(() => {
    const container = containerRef.current;
    if (point === null || container === null) return;
    pendingRoots.add(container);
    return () => { pendingRoots.delete(container); };
  }, [containerRef, point]);

  useEffect(() => {
    if (point === null) return;
    const observer = new MutationObserver(syncPoint);
    observer.observe(point.element, { subtree: true, childList: true, characterData: true });
    for (let element: Element | null = point.element; element !== null; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden", "style", "class"] });
    }
    return () => observer.disconnect();
  }, [point, syncPoint]);

  useEffect(() => {
    if (!pointMode) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (pendingRoots.size > 0) {
        for (const cancel of pendingListeners) cancel();
      } else {
        onExitPointMode?.();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [pointMode, point, onExitPointMode, setButton]);
  return { point, setPoint, hovered, setHovered, outline, setOutline, syncPoint, choosePoint, pointerTypeRef };
}

export function SelectionCapture({ onCapture, extractPoint: extractPointProp, children, className, pointMode: pointModeProp, onExitPointMode, "data-bbx-scan": scan }: SelectionCaptureProps) {
  const pointMode = pointModeProp === true;
  const extractPoint = extractPointProp ?? extractPointSelection;
  const containerRef = useRef<HTMLDivElement>(null);
  const [button, setButton] = useState<FloatingButton | null>(null);
  const { point, setPoint, setHovered, outline, setOutline, syncPoint, choosePoint, pointerTypeRef } = usePointSelection({ containerRef, pointMode, onExitPointMode, setButton, onCapture, extractPoint });

  useEffect(() => {
    const cancel = () => { setPoint(null); setHovered(null); setOutline(null); setButton(null); };
    pendingListeners.add(cancel);
    return () => { pendingListeners.delete(cancel); };
  }, [setPoint, setHovered, setOutline]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    captureRoots.add(container);
    return () => { captureRoots.delete(container); };
  }, []);

  useEffect(() => {
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncPoint);
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
  }, [syncPoint]);

  const handleClick = useCallback(() => {
    if (!pointMode || button === null) return;
    const container = containerRef.current;
    const current = point === null || container === null ? null : extractPoint(point.element, container);
    if (point === null || !pointIsVisible(point.element) || current?.text !== button.text || current.position !== button.position) {
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
  }, [button, onCapture, point, pointMode, extractPoint, setPoint, setOutline]);

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
      onPointerDownCapture={(event) => { pointerTypeRef.current = event.pointerType; }}
      onTouchStartCapture={() => { pointerTypeRef.current = "touch"; }}
      onContextMenuCapture={(event) => {
        const container = containerRef.current;
        if (pointMode && container !== null && event.target instanceof Node && ownsSelection(container, event.target)) event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (!pointMode || event.pointerType !== "mouse") return;
        if (event.target instanceof Element && event.target.closest("#bbx-selection-add") !== null) {
          setHovered(null);
          return;
        }
        const container = containerRef.current;
        if (container === null || !(event.target instanceof Node) || !ownsSelection(container, event.target)) {
          setHovered(null);
          return;
        }
        const target = pointTarget(event.target, container);
        setHovered(target !== null && extractPoint(target, container) !== null ? target : null);
      }}
      onPointerLeave={() => { if (pointMode) setHovered(null); }}
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
          // Keep confirmation interaction inside this capture.
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={handleClick}
          className="bbx-system-control flex items-center justify-center w-11 h-11 rounded-full bg-accent text-white shadow-md hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent z-50"
          style={{
            position: "fixed",
            left: `clamp(8px, ${button.left + 6}px, calc(100% - 2.75rem - 8px))`,
            top: `clamp(8px, ${button.top - 6}px, calc(100% - 2.75rem - 8px))`,
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
