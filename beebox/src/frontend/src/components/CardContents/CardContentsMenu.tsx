/**
 * The contents menu of a long Markdown card: a button at the top right of the
 * card front that stays in view while the reader scrolls, names the section
 * at the top of the card ("Contents" above the first heading), and opens a
 * list of the document's headings. Choosing one scrolls to it.
 *
 * Scrolling is when the reader wants to know where they are, so the button is
 * full while the card scrolls. When scrolling stops it rests: icon only and
 * faint, over the text being read, until hovered, focused, or opened.
 *
 * Headings come from the rendered DOM: the document renderers mark their
 * prose wrapper `data-card-outline` (`Markdown`'s `outline` prop), and the
 * heading node gives each heading a stable id (`makeHeadingNode`). Only
 * headings of the first outline root count, so a card embedded in the body
 * does not add its own headings.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Dropdown } from "../ui/Dropdown";
import { MenuItem } from "../ui/dropdown-menu-item";
import { Button } from "../ui/Button";
import { buildOutline, currentSection, type OutlineEntry, type OutlineItem } from "./outline";

/** How long after the last scroll the button rests. */
const REST_AFTER_MS = 1200;

/** Space between the scroller's top and a heading the menu scrolled to; matches `scroll-margin-top` in card-themes.css. */
const READING_LINE_PX = 48;

export function readOutline(front: HTMLElement): { items: OutlineItem[]; headings: Map<string, HTMLElement> } | null {
  const root = front.querySelector<HTMLElement>("[data-card-outline]");
  if (root === null) return null;
  const headings = new Map<string, HTMLElement>();
  const entries: OutlineEntry[] = [];
  for (const heading of root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]")) {
    if (heading.closest("[data-card-outline]") !== root) continue;
    headings.set(heading.id, heading);
    entries.push({ id: heading.id, level: Number(heading.tagName.slice(1)), text: heading.textContent });
  }
  const items = buildOutline(entries);
  return items === null ? null : { items, headings };
}

/** Same headings in the same order, so the menu need not change. */
function sameOutline(a: ReturnType<typeof readOutline>, b: ReturnType<typeof readOutline>): boolean {
  if (a === null || b === null) return a === b;
  return a.items.length === b.items.length && a.items.every((item, i) => {
    const other = b.items.at(i);
    return other !== undefined && item.id === other.id && item.text === other.text && item.depth === other.depth
      && a.headings.get(item.id) === b.headings.get(item.id);
  });
}

/** The nearest element that scrolls: the card desk, or a chat card's own front. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

function ContentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 4h11M5 8h8.5M5 12h8.5" />
    </svg>
  );
}

export function CardContentsMenu({ id, frontRef }: { id: string; frontRef: RefObject<HTMLElement | null> }) {
  const [outline, setOutline] = useState<ReturnType<typeof readOutline>>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const restTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(restTimer.current), []);

  useEffect(() => {
    const front = frontRef.current;
    if (front === null) return;
    // Keep the same outline while its headings are unchanged: the menu's own
    // label changes as the reader scrolls, and that must not restart the
    // scroll tracking below.
    const read = () => setOutline((previous) => {
      const next = readOutline(front);
      return sameOutline(previous, next) ? previous : next;
    });
    read();
    // Bodies render late (lazy renderers, edits arriving over the bus).
    const observer = new MutationObserver(read);
    observer.observe(front, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [frontRef]);

  const findCurrent = useCallback(() => {
    const front = frontRef.current;
    if (front === null || outline === null) return;
    const scroller = scrollerOf(front);
    const line = (scroller?.getBoundingClientRect().top ?? 0) + READING_LINE_PX;
    const tops = outline.items.flatMap((item) => {
      const heading = outline.headings.get(item.id);
      return heading === undefined ? [] : [{ id: item.id, top: heading.getBoundingClientRect().top }];
    });
    setCurrent(currentSection(tops, line));
  }, [frontRef, outline]);

  // Follow the reader: recompute on the card's own scroll, once per frame.
  useEffect(() => {
    const front = frontRef.current;
    if (front === null || outline === null) return;
    findCurrent();
    const scroller = scrollerOf(front) ?? window;
    let frame = 0;
    const onScroll = () => {
      setScrolling(true);
      window.clearTimeout(restTimer.current);
      restTimer.current = window.setTimeout(() => setScrolling(false), REST_AFTER_MS);
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        findCurrent();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [frontRef, outline, findCurrent]);

  if (outline === null) return null;
  const currentText = outline.items.find((item) => item.id === current)?.text;

  function jump(headingId: string) {
    const heading = outline?.headings.get(headingId);
    if (heading === undefined) return;
    // After the menu closes and returns focus to its button.
    requestAnimationFrame(() => {
      heading.scrollIntoView({ block: "start" });
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    });
  }

  return (
    <div className="bbx-card-contents print:hidden" data-resting={scrolling ? undefined : ""}>
      <Dropdown
        align="right"
        width="w-72 max-w-[calc(100vw-2rem)]"
        trigger={({ toggle, ariaProps }) => (
          <Button
            id={id}
            intent="secondary"
            size="sm"
            icon={<ContentsIcon />}
            title={currentText === undefined ? "Contents: jump to a section" : `In ${currentText}. Contents: jump to a section`}
            onClick={(event) => {
              findCurrent();
              toggle(event);
            }}
            {...ariaProps}
          >
            <span className="bbx-card-contents-label">{currentText ?? "Contents"}</span>
          </Button>
        )}
      >
        <div className="max-h-[min(24rem,70vh)] overflow-y-auto">
          {outline.items.map((item) => (
            <MenuItem key={item.id} active={item.id === current} onClick={() => jump(item.id)}>
              <span className="block truncate" style={{ paddingLeft: `${item.depth}rem` }} title={item.text}>{item.text}</span>
            </MenuItem>
          ))}
        </div>
      </Dropdown>
    </div>
  );
}
