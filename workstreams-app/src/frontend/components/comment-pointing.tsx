import { useEffect, useRef, useState, type RefObject } from "react";

import {
  captureElement, captureSelection, commentTarget, findAnchoredElement,
  findAnchoredRange, isElementFragment, type SelectionAnchor,
} from "../lib/selection-anchor.js";
import type { Comment } from "../types.js";

export type CommentLocation = Element | Range;

export function resolveComment(root: HTMLElement, comment: Comment): CommentLocation | null {
  if (comment.fragment === undefined) return null;
  if (isElementFragment(comment.fragment)) {
    return findAnchoredElement({ root, fragment: comment.fragment, quoted: comment.quoted ?? "" });
  }
  return findAnchoredRange(root, comment.fragment);
}

function bounds(location: CommentLocation): DOMRect { return location.getBoundingClientRect(); }

/** Capture-phase events make pointing win over a link or page click handler. */
export function useCommentPicker(options: {
  rootRef: RefObject<HTMLElement | null>;
  active: boolean;
  composing: boolean;
  onPick: (anchor: SelectionAnchor, location: CommentLocation) => void;
}): { hovered: Element | null } {
  const { rootRef, active, composing, onPick } = options;
  const [hovered, setHovered] = useState<Element | null>(null);
  const pickRef = useRef(onPick);
  useEffect(() => { pickRef.current = onPick; }, [onPick]);
  useEffect(() => {
    const root = rootRef.current;
    if (!active || root === null) return;
    let start: { x: number; y: number; selected: string } | null = null;
    const onDown = (event: PointerEvent): void => {
      start = { x: event.clientX, y: event.clientY, selected: window.getSelection()?.toString() ?? "" };
    };
    const onMove = (event: PointerEvent): void => {
      if (composing || event.pointerType === "touch") return;
      setHovered(commentTarget(event.target instanceof Element ? event.target : null, root));
    };
    const onUp = (event: PointerEvent): void => {
      if (composing) return;
      const selected = window.getSelection()?.toString() ?? "";
      if (selected.trim() !== "" && selected !== start?.selected) {
        const captured = captureSelection(root);
        const range = window.getSelection()?.getRangeAt(0);
        if (captured !== null && range !== undefined) pickRef.current(captured, range.cloneRange());
        return;
      }
      const moved = start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6;
      if (moved) return;
      const target = commentTarget(event.target instanceof Element ? event.target : null, root);
      if (target !== null) pickRef.current(captureElement(root, target), target);
    };
    const onClick = (event: MouseEvent): void => {
      // Click fires after pointerup, including on touch. Keep links and custom
      // exhibit click handlers from acting while the gesture means "comment".
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyUp = (): void => {
      if (composing) return;
      const captured = captureSelection(root);
      const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      if (captured !== null && range !== null && range !== undefined) pickRef.current(captured, range.cloneRange());
    };
    root.addEventListener("pointerdown", onDown, true);
    root.addEventListener("pointermove", onMove, true);
    root.addEventListener("pointerup", onUp, true);
    root.addEventListener("click", onClick, true);
    root.addEventListener("keyup", onKeyUp);
    return () => {
      root.removeEventListener("pointerdown", onDown, true);
      root.removeEventListener("pointermove", onMove, true);
      root.removeEventListener("pointerup", onUp, true);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("keyup", onKeyUp);
    };
  }, [rootRef, active, composing]);
  return {
    hovered: active && !composing ? hovered : null,
  };
}

/** Read positions from the live DOM, so scrolling and exhibit re-renders move pins. */
export function useCommentPositions({ rootRef, items, active }: { rootRef: RefObject<HTMLElement | null>; items: Comment[]; active: boolean }): {
  anchored: Array<{ comment: Comment; location: CommentLocation; rect: DOMRect }>;
  unresolved: number;
} {
  const [positions, setPositions] = useState<{
    anchored: Array<{ comment: Comment; location: CommentLocation; rect: DOMRect }>;
    unresolved: number;
  }>({ anchored: [], unresolved: 0 });
  useEffect(() => {
    const root = rootRef.current;
    const update = (): void => {
      if (root === null) { setPositions({ anchored: [], unresolved: items.length }); return; }
      const anchored: Array<{ comment: Comment; location: CommentLocation; rect: DOMRect }> = [];
      let unresolved = 0;
      for (const comment of items) {
        const location = resolveComment(root, comment);
        if (location === null) { unresolved += 1; continue; }
        anchored.push({ comment, location, rect: bounds(location) });
      }
      setPositions({ anchored, unresolved });
    };
    let frame: number | null = null;
    const schedule = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; update(); });
    };
    const observer = root === null ? null : new MutationObserver(schedule);
    if (root !== null) observer?.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["src", "alt", "aria-label"] });
    update();
    return () => {
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [rootRef, items]);
  useEffect(() => {
    if (!active) return;
    const update = (): void => { setPositions((current) => ({
      ...current,
      anchored: current.anchored.map((entry) => ({ ...entry, rect: bounds(entry.location) })),
    })); };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [active]);
  return positions;
}

export function CommentOverlay({ hovered, anchored, layoutKey, onMarker }: {
  hovered: Element | null;
  anchored: Array<{ comment: Comment; location: CommentLocation; rect: DOMRect }>;
  layoutKey: string;
  onMarker: (comment: Comment) => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const update = (): void => { setRect(hovered?.getBoundingClientRect() ?? null); };
    const frame = requestAnimationFrame(update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [hovered, layoutKey]);
  return (
    <div className="comment-overlay" aria-hidden={false}>
      {rect === null ? null : <div className="comment-target-outline" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />}
      {anchored.map(({ comment, location }) => {
        const marker = bounds(location);
        if (marker.bottom <= 0 || marker.top >= window.innerHeight || marker.right <= 0 || marker.left >= window.innerWidth) return null;
        return <button
          key={comment.id}
          className="comment-marker"
          style={{ left: Math.max(0, Math.min(window.innerWidth - 30, marker.right)), top: Math.max(0, marker.top) }}
          aria-label={`Show comment: ${comment.body.slice(0, 80)}`}
          onClick={() => { onMarker(comment); }}
          type="button"
        >●</button>;
      })}
    </div>
  );
}

export function scrollToComment(location: CommentLocation): void {
  if (location instanceof Element) location.scrollIntoView({ block: "center", behavior: "smooth" });
  else location.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
}
