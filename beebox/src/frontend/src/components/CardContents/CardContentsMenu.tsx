/**
 * The contents menu of a long Markdown card: a button at the top right of the
 * card front that stays in view while the reader scrolls, names the section
 * at the top of the card ("Contents" above the first heading), and opens a
 * list of the document's headings. Choosing one scrolls to it.
 *
 * Scrolling is when the reader wants to know where they are, so the button is
 * full while the reader scrolls the card. Otherwise it rests: icon only and
 * faint, over the text being read, until hovered, focused, or opened. The
 * full look is the `data-scrolling` attribute, set and cleared on the element
 * directly, so scrolling renders nothing. A scroll the reader did not start
 * (the browser keeping the reader's place while text above grows or shrinks,
 * as when an agent edits the card) leaves the button at rest.
 *
 * Headings come from the card's document (`CardOutlineContext`, published by
 * `Markdown`'s `outline` prop). The DOM is read only to find where each
 * heading is: for the current-section label, a jump, and which headings are
 * on screen when the list opens.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Menu } from "../ui/Menu";
import { MenuItem } from "../ui/menu-item";
import { Button } from "../ui/Button";
import { buildOutline, currentSection, type OutlineEntry, type OutlineItem } from "./outline";

/** How long after the reader's last scroll the button rests. */
const REST_AFTER_MS = 1200;

/** How recent the reader's input must be for a scroll to be theirs. */
const INPUT_MS = 500;

/** Space between the scroller's top and a heading the menu scrolled to; matches `scroll-margin-top` in card-themes.css. */
const READING_LINE_PX = 48;

const SCROLL_KEYS: ReadonlySet<string> = new Set([" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"]);

/**
 * The card document's heading elements by id: those of the first outline
 * root, none inside an embed (`data-card-embed`) or an embedded card's own
 * outline root.
 */
function headingElements(front: HTMLElement): Map<string, HTMLElement> {
  const headings = new Map<string, HTMLElement>();
  const root = front.querySelector<HTMLElement>("[data-card-outline]");
  if (root === null) return headings;
  for (const heading of root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]")) {
    if (heading.closest("[data-card-outline]") !== root || heading.closest("[data-card-embed]") !== null) continue;
    if (!headings.has(heading.id)) headings.set(heading.id, heading);
  }
  return headings;
}

/** The nearest element that scrolls: the card desk, or a chat card's own front. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/** A key typed into a field edits it; it does not scroll the card. */
function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]") !== null);
}

function ContentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 4h11M5 8h8.5M5 12h8.5" />
    </svg>
  );
}

/** The open list: only headings on screen (a composing body hides its region's headings). */
function ContentsList({ items, current, frontRef, onJump }: {
  items: readonly OutlineItem[];
  current: string | null;
  frontRef: RefObject<HTMLElement | null>;
  onJump: (id: string) => void;
}) {
  const [shown, setShown] = useState<readonly OutlineItem[]>(items);
  useLayoutEffect(() => {
    const front = frontRef.current;
    if (front === null) return;
    const headings = headingElements(front);
    setShown(items.filter((item) => headings.has(item.id)));
  }, [items, frontRef]);
  return (
    <div className="max-h-[min(24rem,70vh)] overflow-y-auto">
      {shown.map((item) => (
        <MenuItem key={item.id} active={item.id === current} onClick={() => onJump(item.id)}>
          <span className="block truncate" style={{ paddingLeft: `${item.depth}rem` }} title={item.text}>{item.text}</span>
        </MenuItem>
      ))}
    </div>
  );
}

export function CardContentsMenu({ id, frontRef, entries }: {
  id: string;
  frontRef: RefObject<HTMLElement | null>;
  /** The card document's headings (`useCardOutline`); `null` before it renders. */
  entries: readonly OutlineEntry[] | null;
}) {
  const items = useMemo(() => (entries === null ? null : buildOutline(entries)), [entries]);
  const [current, setCurrent] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const lastInput = useRef(Number.NEGATIVE_INFINITY);
  const restTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(restTimer.current), []);

  const findCurrent = useCallback(() => {
    const front = frontRef.current;
    if (front === null || items === null) return;
    const scroller = scrollerOf(front);
    const line = (scroller?.getBoundingClientRect().top ?? 0) + READING_LINE_PX;
    const headings = headingElements(front);
    const tops = items.flatMap((item) => {
      const heading = headings.get(item.id);
      return heading === undefined ? [] : [{ id: item.id, top: heading.getBoundingClientRect().top }];
    });
    setCurrent(currentSection(tops, line));
  }, [frontRef, items]);

  // Follow the reader: recompute on the card's own scroll, once per frame,
  // and show the full button while the reader is the one scrolling.
  useEffect(() => {
    const front = frontRef.current;
    if (front === null || items === null) return;
    findCurrent();
    const scroller = scrollerOf(front);
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    const input = () => {
      lastInput.current = performance.now();
    };
    // A drag on the scroller's own scrollbar (the page's, when the window
    // scrolls); a press on the text selects it.
    const scrollbarOwner = scroller ?? document.documentElement;
    const onPointerDown = (event: Event) => {
      if (event.target === scrollbarOwner) input();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key) || isEditable(event.target)) return;
      const within = scroller ?? front;
      const inCard = event.target === document.body || (event.target instanceof Node && within.contains(event.target));
      if (inCard) input();
    };
    const onScroll = () => {
      const element = wrapper.current;
      // A fling keeps scrolling after the finger lifts: an ongoing reader
      // scroll continues while scroll events keep coming.
      if (element !== null && (performance.now() - lastInput.current < INPUT_MS || element.hasAttribute("data-scrolling"))) {
        element.setAttribute("data-scrolling", "");
        window.clearTimeout(restTimer.current);
        restTimer.current = window.setTimeout(() => element.removeAttribute("data-scrolling"), REST_AFTER_MS);
      }
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        findCurrent();
      });
    };
    target.addEventListener("wheel", input, { passive: true });
    target.addEventListener("touchstart", input, { passive: true });
    target.addEventListener("touchmove", input, { passive: true });
    target.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    target.addEventListener("scroll", onScroll, { passive: true });
    // Text added or removed above a heading moves it without a scroll event
    // (at the top of the card, nothing anchors the reader's place).
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(() => {
        frame = 0;
        findCurrent();
      });
    });
    resize?.observe(front);
    return () => {
      resize?.disconnect();
      target.removeEventListener("wheel", input);
      target.removeEventListener("touchstart", input);
      target.removeEventListener("touchmove", input);
      target.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [frontRef, items, findCurrent]);

  const jump = useCallback((headingId: string) => {
    const front = frontRef.current;
    const heading = front === null ? undefined : headingElements(front).get(headingId);
    if (heading === undefined) return;
    // After the menu closes and returns focus to its button.
    requestAnimationFrame(() => {
      // The reader asked for this scroll: the button shows where it landed.
      lastInput.current = performance.now();
      heading.scrollIntoView({ block: "start" });
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    });
  }, [frontRef]);

  if (items === null) return null;
  const currentText = items.find((item) => item.id === current)?.text;

  return (
    <div ref={wrapper} className="bbx-card-contents print:hidden">
      <Menu
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
        <ContentsList items={items} current={current} frontRef={frontRef} onJump={jump} />
      </Menu>
    </div>
  );
}
