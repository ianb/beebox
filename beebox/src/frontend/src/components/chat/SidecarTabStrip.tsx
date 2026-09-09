/**
 * The sidecar's tab strip: the row of open documents beside chat.
 *
 * Its own module because it owns behaviour the pane around it does not — the
 * element refs that let the active tab scroll itself into view, the pinned
 * group's separate scroller, and the mark/abbreviation rules for a pinned tab
 * (`tab-identity.ts`).
 */

import { useEffect, useRef, useCallback } from "react";
import { cn } from "../../lib/cn";
import { prefersReducedMotion } from "../../lib/reduced-motion";
import { displayName } from "../../lib/display-name";
import { CardMark } from "../ui/CardMark";
import { useBoxPresentation } from "../themes/BoxPresentationProvider";
import { resolveCardTheme, type ResolvedThemeChoice } from "@shared/card-theme";
import type { CardIdentity } from "../../hooks/useCardIdentities";
import { ambiguousMarks, pinnedFace } from "./tab-identity";
import type { PanelTab } from "./InteractiveChat-controls";

/**
 * The pin. Filled when the tab is pinned, outline when the control is only
 * offering — the state and the offer must not look the same (principle 13).
 */
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z" />
      <path d="M12 15v5" />
    </svg>
  );
}

function nextTabIndex(key: string, position: { index: number; length: number }): number | null {
  const { index, length } = position;
  if (key === "ArrowRight") return (index + 1) % length;
  if (key === "ArrowLeft") return (index + length - 1) % length;
  if (key === "Home") return 0;
  return key === "End" ? length - 1 : null;
}

export function SidecarTabStrip({ id, tabs, activePath, identities, boxSlug, onSelectTab, onCloseTab, onTogglePin }: {
  id: string;
  tabs: PanelTab[];
  activePath: string;
  /** Live title + mark per path — see `useCardIdentities`. */
  identities: Map<string, CardIdentity>;
  boxSlug: string | undefined;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onTogglePin: (path: string) => void;
}) {
  const presentation = useBoxPresentation();
  // Tab elements by path, so the active one can be scrolled into view. With
  // more open documents than the strip can show, a newly opened tab landed
  // outside the visible range and the open read as a no-op — the highlight
  // existed, off-screen (2026-08-29).
  const tabRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pinned = tabs.filter((t) => t.pinned);
  const loose = tabs.filter((t) => !t.pinned);
  // Scoped to the pinned tabs on purpose — see `tab-identity.ts`.
  const ambiguous = ambiguousMarks(pinned.map((t) => ({ symbol: identities.get(t.target.path)?.symbol ?? null })));

  const revealActive = useCallback(() => {
    const el = tabRefs.current.get(activePath);
    if (el === undefined) return;
    const scroller = el.parentElement;
    if (scroller !== null) {
      const strip = scroller.getBoundingClientRect();
      const tab = el.getBoundingClientRect();
      // Already visible: leave it alone. Re-scrolling a visible tab is the
      // churn that makes a strip feel like it is fighting you.
      if (tab.left >= strip.left - 1 && tab.right <= strip.right + 1) return;
    }
    // `inline: "nearest"` scrolls the minimum needed; `block: "nearest"` keeps
    // this from scrolling any ancestor, since scrollIntoView walks every
    // scrollable ancestor and the chat shell is fixed.
    el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [activePath]);

  useEffect(() => {
    revealActive();
  }, [revealActive, tabs.length, pinned.length]);

  // The strip's width is not settled when a restored strip first renders — the
  // pane is still laying out, so every tab measures as visible and nothing
  // scrolls. Watching the scroller catches that, and a window resize with it.
  // Whichever scroller holds the active tab is the one to watch: pinned tabs
  // have their own, and it overflows too once several are pinned.
  useEffect(() => {
    const scroller = tabRefs.current.get(activePath)?.parentElement;
    if (scroller === undefined || scroller === null) return;
    const observer = new ResizeObserver(() => revealActive());
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [revealActive, activePath]);

  function renderTab(tab: PanelTab) {
    const isActive = tab.target.path === activePath;
    const identity = identities.get(tab.target.path) ?? null;
    // The stored label is what the link that opened this tab called it — a
    // stand-in until the card's own title arrives, never the final word.
    const title = identity?.title ?? displayName(tab.target.path);
    const face = pinnedFace({ symbol: identity?.symbol ?? null, title, ambiguous });
    const theme: ResolvedThemeChoice = identity?.type === undefined || presentation?.data === undefined
      ? { name: "plain", stock: "neutral" }
      : resolveCardTheme({
        path: tab.target.path.replace(/^\//, ""),
        type: identity.type,
        cardChoice: identity.cardTheme,
        typeDefault: presentation.data.typeDefaults[identity.type],
        presentation: presentation.data.presentation,
      }).choice;
    return (
      <div
        key={tab.target.path}
        role="none"
        ref={(el) => {
          if (el === null) tabRefs.current.delete(tab.target.path);
          else tabRefs.current.set(tab.target.path, el);
        }}
        className={cn(
          "bbx-card-theme bbx-interface-tab group flex-shrink-0 flex items-center",
          // A pinned tab is compact, the way a browser's is: it is there to hold
          // its place, not to be read. The full path is still in its title.
          tab.pinned ? "max-w-[7rem]" : "max-w-[14rem]",
        )}
        data-active={isActive || undefined}
        data-card-theme={theme.name}
        data-card-stock={theme.stock}
      >
        <button
          type="button"
          role="tab"
          id={`bbx-workspace-tab-${encodeURIComponent(tab.target.path)}`}
          aria-controls={isActive ? `bbx-workspace-panel-${encodeURIComponent(tab.target.path)}` : undefined}
          tabIndex={isActive ? 0 : -1}
          onKeyDown={(event) => {
            const index = tabs.findIndex((item) => item.target.path === tab.target.path);
            const next = nextTabIndex(event.key, { index, length: tabs.length });
            if (next === null) return;
            event.preventDefault();
            const target = tabs[next];
            if (target) onSelectTab(target.target.path);
          }}
          aria-selected={isActive}
          onClick={() => onSelectTab(tab.target.path)}
          // The full title and path stay reachable on hover, which is where a
          // mark-only tab's identity lives.
          title={`${title}\n${tab.target.path}`}
          className={cn(
            "flex-1 min-w-0 flex items-center gap-1 overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            tab.pinned ? "text-xs pl-2 pr-0.5 py-1.5 justify-center" : "text-sm pl-2 pr-1 py-1.5",
            isActive ? "font-medium" : "",
          )}
        >
          {tab.pinned ? (
            <>
              <CardMark symbol={face.mark} size="xs" boxSlug={boxSlug} />
              {face.abbreviation === null ? null : <span className="min-w-0 flex-1 truncate">{face.abbreviation}</span>}
            </>
          ) : (
            <>
              <CardMark symbol={identity?.symbol ?? null} size="xs" boxSlug={boxSlug} />
              <span className="min-w-0 flex-1 truncate">{title}</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(tab.target.path);
          }}
          aria-label={tab.pinned ? `Unpin ${tab.label}` : `Pin ${tab.label}`}
          aria-pressed={tab.pinned}
          title={tab.pinned ? "Unpin tab" : "Pin tab"}
          className={cn(
            "bbx-interface-tab-action flex-shrink-0 p-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            // Pinned: always shown, because it is the only thing that says the
            // tab is pinned. Unpinned: revealed on hover or keyboard focus, so
            // a row of tabs is not a row of icons.
            tab.pinned ? "bbx-interface-tab-pin" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <PinIcon filled={tab.pinned} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCloseTab(tab.target.path);
          }}
          aria-label={`Close ${tab.label}`}
          title="Close tab"
          className={cn(
            "bbx-interface-tab-action flex-shrink-0 mr-1 p-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            // On a pinned tab the close button is the thing you did not ask
            // for; it stays out of the way until you reach for it.
            tab.pinned ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : "",
          )}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6l-12 12" />
          </svg>
        </button>
      </div>
    );
  }

  // Two scrollers, not one strip with sticky pins: a sticky tab occludes what
  // scrolls under it, and `scrollIntoView` cannot see occlusion — it would call
  // a tab parked behind the pins visible and never scroll to it. Separate
  // scrollers make "pinned tabs stay put" true by construction. The inner
  // ARIA ownership groups only selection buttons as tabs. Their adjacent pin
  // and close buttons remain independent controls, outside the tablist.
  return <div id={id} className="bbx-interface-tabstrip flex-1 min-w-0 flex">
      <div role="tablist" aria-label="Open files" className="absolute" aria-owns={tabs.map((tab) => `bbx-workspace-tab-${encodeURIComponent(tab.target.path)}`).join(" ")} />
      {pinned.length > 0 ? (
        <div role="none" className="flex-shrink-0 max-w-[50%] flex overflow-x-auto border-r-2 border-warm-400 bg-warm-100">
          {pinned.map(renderTab)}
        </div>
      ) : null}
      <div role="none" className="flex-1 min-w-0 flex overflow-x-auto">
        {loose.map(renderTab)}
      </div>
    </div>;
}
