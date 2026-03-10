/**
 * Source view overlay — highlights elements tagged with data-cb-source
 * and allows clicking to inspect/copy their source identifiers.
 *
 * Toggle with Ctrl+Shift+S or via the profile menu.
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface SelectedSource {
  source: string;
  item: string | null;
  rect: DOMRect;
}

/**
 * Walk up from an element to find the nearest data-cb-source.
 */
function findSourceElement(el: Element): Element | null {
  let current: Element | null = el;
  while (current) {
    if (current.hasAttribute("data-cb-source")) return current;
    current = current.parentElement;
  }
  return null;
}

function clearSelectedClass() {
  for (const el of document.querySelectorAll(".cb-source-selected")) {
    el.classList.remove("cb-source-selected");
  }
}

/**
 * Hook to manage source view active state with keyboard shortcut.
 */
export function useSourceView() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "S") {
        e.preventDefault();
        setActive((v) => !v);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const toggle = useCallback(() => setActive((v) => !v), []);

  return { active, toggle };
}

interface SourceViewOverlayProps {
  active: boolean;
  onClose: () => void;
}

/**
 * Inner component that gets remounted (via key) when source view is toggled,
 * so all state resets automatically without setState-in-effect.
 */
export function SourceViewOverlay({ active, onClose }: SourceViewOverlayProps) {
  if (!active) return null;
  return <SourceViewOverlayInner onClose={onClose} />;
}

function SourceViewOverlayInner({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<SelectedSource | null>(null);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [copied, setCopied] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Inject/remove the highlight stylesheet
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "cb-source-view-style";
    style.textContent = `
      [data-cb-source] {
        outline: 2px dashed rgba(139, 92, 246, 0.4) !important;
        outline-offset: 2px;
        position: relative;
      }
      [data-cb-source]:hover {
        outline-color: rgba(139, 92, 246, 0.8) !important;
        background-color: rgba(139, 92, 246, 0.05) !important;
      }
      [data-cb-source].cb-source-selected {
        outline: 2px solid rgba(139, 92, 246, 1) !important;
        background-color: rgba(139, 92, 246, 0.1) !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      const existing = document.getElementById("cb-source-view-style");
      if (existing) existing.remove();
      clearSelectedClass();
    };
  }, []);

  // Click handler — intercepts clicks on source-tagged elements
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // Don't intercept clicks on our own overlay
      if (overlayRef.current && overlayRef.current.contains(e.target as Node)) return;

      const target = e.target as Element;
      const sourceEl = findSourceElement(target);

      if (sourceEl) {
        e.preventDefault();
        e.stopPropagation();

        clearSelectedClass();
        sourceEl.classList.add("cb-source-selected");
        const source = sourceEl.getAttribute("data-cb-source") || "";
        const item = sourceEl.getAttribute("data-cb-source-item");
        setSelected({ source, item, rect: sourceEl.getBoundingClientRect() });
        setCopied(false);
      } else {
        clearSelectedClass();
        setSelected(null);
      }
    }

    // Use capture phase so we can intercept before normal click handlers
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  // Hover handler for showing labels
  useEffect(() => {
    function handleMove(e: MouseEvent) {
      const target = e.target as Element;
      const sourceEl = findSourceElement(target);

      if (sourceEl !== hovered) {
        setHovered(sourceEl);
      }
    }

    document.addEventListener("mousemove", handleMove);
    return () => document.removeEventListener("mousemove", handleMove);
  }, [hovered]);

  // Escape to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (selected) {
          clearSelectedClass();
          setSelected(null);
        } else {
          onClose();
        }
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selected, onClose]);

  const handleCopy = useCallback(() => {
    if (!selected) return;
    const text = selected.item ? `${selected.source} — ${selected.item}` : selected.source;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback not needed — clipboard API works in secure contexts
    });
  }, [selected]);

  return (
    <div ref={overlayRef}>
      <ModeBar onClose={onClose} />

      {hovered && !selected ? (
        <HoverLabel element={hovered} />
      ) : null}

      {selected ? (
        <SelectedPanel selected={selected} copied={copied} onCopy={handleCopy} />
      ) : null}
    </div>
  );
}

/**
 * Top bar indicating source view mode.
 */
function ModeBar({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-violet-600 text-white text-xs py-1 px-3 flex items-center justify-between">
      <span className="font-medium">Source View — click elements to inspect</span>
      <div className="flex items-center gap-3">
        <span className="text-white/60">Esc to close</span>
        <button onClick={onClose} className="hover:text-white/80">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Bottom panel showing details of the selected source element.
 */
function SelectedPanel({ selected, copied, onCopy }: { selected: SelectedSource; copied: boolean; onCopy: () => void }) {
  const pairs = selected.source.split(" ").map((pair) => {
    const colonIdx = pair.indexOf(":");
    return { type: pair.substring(0, colonIdx), id: pair.substring(colonIdx + 1) };
  });

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[9999] bg-white rounded-lg shadow-xl border border-warm-200 overflow-hidden">
      <div className="px-3 py-2 bg-violet-50 border-b border-violet-100 flex items-center justify-between">
        <span className="text-xs font-semibold text-violet-700">Source</span>
        <button
          onClick={onCopy}
          className="text-xs text-violet-600 hover:text-violet-800 font-medium"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="px-3 py-2 space-y-1">
        {pairs.map((pair, i) => (
          <SourcePair key={i} type={pair.type} id={pair.id} />
        ))}
        {selected.item ? (
          <div className="pt-1 border-t border-warm-100">
            <span className="text-xs text-warm-500">Item: </span>
            <span className="text-sm text-warm-700">{selected.item}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SourcePair({ type, id }: { type: string; id: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] font-mono bg-violet-100 text-violet-700 px-1 py-0.5 rounded flex-shrink-0">
        {type}
      </span>
      <span className="text-sm text-warm-800 font-mono break-all">{id}</span>
    </div>
  );
}

/**
 * Floating label shown near the hovered source element.
 */
function HoverLabel({ element }: { element: Element }) {
  const source = element.getAttribute("data-cb-source") || "";
  const rect = element.getBoundingClientRect();

  // Position above the element, clamped to viewport
  const top = Math.max(28, rect.top - 24);
  const left = Math.max(4, Math.min(rect.left, window.innerWidth - 300));

  const pairs = source.split(" ").map((p) => {
    const colonIdx = p.indexOf(":");
    return { type: p.substring(0, colonIdx), id: p.substring(colonIdx + 1) };
  });

  return (
    <div
      className="fixed z-[9998] pointer-events-none"
      style={{ top: `${top}px`, left: `${left}px` }}
    >
      <div className="bg-violet-700 text-white text-[10px] px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1 max-w-[290px]">
        {pairs.map((p, i) => (
          <span key={i} className="truncate">
            <span className="font-semibold">{p.type}:</span>{p.id}
          </span>
        ))}
      </div>
    </div>
  );
}
