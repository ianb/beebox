/**
 * The sidecar's tab strip: the row of open documents beside chat.
 *
 * Its own module because it owns behaviour the pane around it does not — the
 * element refs that let the active tab scroll itself into view, the pinned
 * group's separate scroller, and the mark/abbreviation rules for a pinned tab
 * (`tab-identity.ts`).
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "../../../../lib/cn";
import { prefersReducedMotion } from "../../../../lib/reduced-motion";
import { displayName } from "../../../../lib/display-name";
import { CardMark } from "../../../ui/CardMark";
import { useBoxPresentation } from "../../../themes/BoxPresentationProvider";
import { resolveCardTheme, type ResolvedThemeChoice } from "@shared/card-theme/core";
import type { CardIdentity } from "../../../../hooks/useCardIdentities";
import { ambiguousMarks, pinnedFace } from "./tab-identity";
import type { PanelTab } from "../../InteractiveChat-controls";
import { workspacePanelId, workspaceTabId } from "../address";

function themeForTab({ path, identity, presentation }: { path: string; identity: CardIdentity | null; presentation: ReturnType<typeof useBoxPresentation> }): ResolvedThemeChoice {
  if ((identity?.type === undefined && !path.endsWith(".md")) || presentation?.data === undefined) {
    return { name: "plain", stock: "neutral" };
  }
  const type = identity?.type ?? "";
  return resolveCardTheme({ path: path.replace(/^\//, ""), type, cardChoice: identity?.cardTheme,
    typeDefault: identity?.type === undefined ? undefined : presentation.data.typeDefaults[type],
    presentation: presentation.data.presentation, systemTheme: presentation.data.chrome.choice.name }).choice;
}

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

/**
 * Where to scroll so the strip's left edge starts on a whole tab. Scrolling
 * only as far as the revealed tab needs cut the leftmost tab through its
 * middle: its label went under the fade and only its "×" showed (journey
 * walks, 2026-10-08/09). Moves on to the next tab start at or past `from`,
 * never past `limit` (the revealed tab's own start).
 */
function wholeTabStart({ scroller, from, limit }: { scroller: HTMLElement; from: number; limit: number }): number {
  for (const child of scroller.children) {
    const start = scrollPosition(scroller, child);
    if (start >= from) return Math.min(start, limit);
  }
  return limit;
}

/**
 * An element's left edge in the scroller's scroll coordinates. Not
 * `offsetLeft`: the scroller is the offset parent only on a themed card
 * (interface.css positions it there), so on a neutral card that value
 * includes the pane's own position on the page.
 */
function scrollPosition(scroller: HTMLElement, el: Element): number {
  return el.getBoundingClientRect().left - scroller.getBoundingClientRect().left - scroller.clientLeft + scroller.scrollLeft;
}

function revealTab({ activePath, tabRefs, setOverflow }: { activePath: string; tabRefs: { current: Map<string, HTMLElement> }; setOverflow: (value: { left: boolean; right: boolean }) => void }) {
  const el = tabRefs.current.get(activePath);
  const scroller = el?.parentElement;
  if (scroller === null || scroller === undefined || el === undefined) return;
  const left = scrollPosition(scroller, el);
  const right = left + el.offsetWidth;
  const trailing = parseFloat(scroller.style.getPropertyValue("--bbx-tab-trailing")) || 0;
  if (trailing > 0 && scroller.scrollWidth - trailing <= scroller.clientWidth) scroller.style.removeProperty("--bbx-tab-trailing");
  if (left < scroller.scrollLeft) {
    scroller.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  } else if (right > scroller.scrollLeft + scroller.clientWidth) {
    const target = wholeTabStart({ scroller, from: right - scroller.clientWidth, limit: left });
    // Near the end the browser clamps the scroll to the last tab's edge, which
    // would cut the leftmost tab again; give the strip just enough trailing
    // room (`--bbx-tab-trailing`, interface.css). It stays until the next
    // reveal that scrolls right, so a later no-op reveal cannot clamp it away.
    const short = target + scroller.clientWidth - (scroller.scrollWidth - trailing);
    scroller.style.setProperty("--bbx-tab-trailing", `${Math.max(0, short)}px`);
    scroller.scrollTo({ left: target, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }
  setOverflow({ left: scroller.scrollLeft > 1, right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1 });
}

function useTabStripReveal({ activePath, tabRefs, tabCount, pinnedCount }: { activePath: string; tabRefs: { current: Map<string, HTMLElement> }; tabCount: number; pinnedCount: number }) {
  const [overflow, setOverflow] = useState({ left: false, right: false });
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      revealTab({ activePath, tabRefs, setOverflow });
      requestAnimationFrame(() => revealTab({ activePath, tabRefs, setOverflow }));
    });
    return () => cancelAnimationFrame(frame);
  }, [activePath, tabCount, pinnedCount, tabRefs]);
  useEffect(() => {
    const scroller = tabRefs.current.get(activePath)?.parentElement;
    if (scroller === undefined || scroller === null) return;
    const update = () => setOverflow({ left: scroller.scrollLeft > 1, right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1 });
    const observer = new ResizeObserver(() => revealTab({ activePath, tabRefs, setOverflow }));
    observer.observe(scroller);
    scroller.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", update);
    };
  }, [activePath, tabCount, pinnedCount, tabRefs]);
  return overflow;
}

/**
 * A tab's close button. `closing` names a close that means more than closing,
 * "Not now" on a pending question (docs/implemented-plans/questions-beside-the-chat.md).
 */
function TabCloseButton({ title, pinned, closing, onClose }: { title: string; pinned: boolean; closing: string | null; onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      aria-label={closing === null ? `Close ${title}` : `${closing}: ${title}`}
      title={closing ?? "Close tab"}
      data-close-kind={closing === null ? undefined : "not-now"}
      className={cn(
        "bbx-interface-tab-action flex-shrink-0 mr-1 p-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        // On a pinned tab the close button is the thing you did not ask
        // for; it stays out of the way until you reach for it.
        pinned ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : "",
      )}
    >
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6l-12 12" />
      </svg>
    </button>
  );
}

export function SidecarTabStrip({ id, tabs, activePath, identities, boxSlug, onSelectTab, onCloseTab, onTogglePin, closeLabel }: {
  id: string;
  tabs: PanelTab[];
  activePath: string;
  /** Live title + mark per path — see `useCardIdentities`. */
  identities: Map<string, CardIdentity>;
  boxSlug: string | undefined;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  /** A tab whose close means more than closing, e.g. "Not now" on a pending question; null for a plain close. */
  closeLabel?: (path: string) => string | null;
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
  const overflow = useTabStripReveal({ activePath, tabRefs, tabCount: tabs.length, pinnedCount: pinned.length });

  // The stored label is what the link that opened this tab called it — a
  // stand-in until the card's own title arrives, never the final word.
  const titleOf = (tab: PanelTab) => identities.get(tab.target.path)?.title ?? displayName(tab.target.path);
  const titleCounts = new Map<string, number>();
  for (const tab of tabs) titleCounts.set(titleOf(tab), (titleCounts.get(titleOf(tab)) ?? 0) + 1);

  function renderTab(tab: PanelTab) {
    const isActive = tab.target.path === activePath;
    const identity = identities.get(tab.target.path) ?? null;
    const title = titleOf(tab);
    // Two open cards can share a title; their names then carry the path.
    const name = (titleCounts.get(title) ?? 0) > 1 ? `${title} (${tab.target.path})` : title;
    const face = pinnedFace({ symbol: identity?.symbol ?? null, title, ambiguous });
    const theme = themeForTab({ path: tab.target.path, identity, presentation });
    return (
      <div
        key={tab.target.path}
        role="none"
        ref={(el) => {
          if (el === null) tabRefs.current.delete(tab.target.path);
          else tabRefs.current.set(tab.target.path, el);
        }}
        className={cn(
          "bbx-card-theme bbx-interface-tab group flex items-center",
          // A pinned tab is compact, the way a browser's is: it is there to hold
          // its place, not to be read. The full path is still in its title.
          // Unpinned tabs shrink well below their label before the strip
          // scrolls; a narrow one tucks its actions away (interface.css).
          tab.pinned ? "flex-shrink-0 max-w-[7rem]" : "w-56 min-w-[5.5rem] max-w-[14rem] shrink",
        )}
        data-active={isActive || undefined}
        data-pinned={tab.pinned || undefined}
        data-card-theme={theme.name}
        data-card-stock={theme.stock}
      >
        <button
          type="button"
          role="tab"
          id={workspaceTabId(tab.target.path)}
          aria-controls={isActive ? workspacePanelId(tab.target.path) : undefined}
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
          aria-label={name === title ? undefined : name}
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
          aria-label={tab.pinned ? `Unpin ${name}` : `Pin ${name}`}
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
        <TabCloseButton title={name} pinned={tab.pinned} closing={closeLabel?.(tab.target.path) ?? null} onClose={() => onCloseTab(tab.target.path)} />
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
      <div role="tablist" aria-label="Open files" className="absolute" aria-owns={tabs.map((tab) => workspaceTabId(tab.target.path)).join(" ")} />
      {pinned.length > 0 ? (
        <div role="none" data-overflow-left={overflow.left || undefined} data-overflow-right={overflow.right || undefined} className="flex-shrink-0 max-w-[50%] flex overflow-x-auto overflow-y-hidden overscroll-x-contain overscroll-y-none border-r-2 border-warm-400 bg-warm-100">
          {pinned.map(renderTab)}
        </div>
      ) : null}
      <div role="none" data-overflow-left={overflow.left || undefined} data-overflow-right={overflow.right || undefined} className="flex-1 min-w-0 flex overflow-x-auto overflow-y-hidden overscroll-x-contain overscroll-y-none">
        {loose.map(renderTab)}
      </div>
    </div>;
}
