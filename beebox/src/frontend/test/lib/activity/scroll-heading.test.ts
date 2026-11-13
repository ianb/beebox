// Scroll activity for companion-pane cards: the topmost visible heading, logged once
// scrolling has settled for a second and only when it changed. Raw positions
// are never logged; content without headings logs nothing.

import "../../helpers/dom-globals.js";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createHeadingScrollTracker, topmostHeadingIn, topmostVisibleHeading, type HeadingBox } from "../../../src/lib/activity/scroll-heading.js";
import { manualClock } from "./manual-clock.js";

const viewport = { top: 100, bottom: 500 };

void test("the topmost heading with any part in view wins, text trimmed and capped", async (t) => {
  const headings: HeadingBox[] = [
    { text: "Above", top: 0, bottom: 30 },
    { text: "  Moles\n   and  mass ", top: 90, bottom: 120 },
    { text: "Later", top: 300, bottom: 330 },
  ];
  t.check(topmostVisibleHeading(headings, viewport), "Moles and mass");
  t.check(topmostVisibleHeading(headings.slice(2), viewport), "Later");
  t.check(topmostVisibleHeading([{ text: "x".repeat(300), top: 200, bottom: 230 }], viewport), `${"x".repeat(119)}…`);
});

void test("no heading in view, or no headings at all, gives nothing", async (t) => {
  t.check(topmostVisibleHeading([], viewport), null);
  t.check(topmostVisibleHeading([{ text: "Above", top: 0, bottom: 30 }, { text: "Below", top: 600, bottom: 630 }], viewport), null);
  t.check(topmostVisibleHeading([{ text: "   ", top: 200, bottom: 230 }], viewport), null);
});

void test("the DOM reader looks at h1 to h4 only", async (t) => {
  const container = document.createElement("div");
  container.innerHTML = "<p>intro</p><h5>Minor</h5><h2>Real</h2>";
  const rect = (top: number, bottom: number) => () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
  container.getBoundingClientRect = rect(0, 400);
  for (const node of container.querySelectorAll("h5, h2")) node.getBoundingClientRect = rect(50, 80);
  t.check(topmostHeadingIn(container), "Real");
});

/** A tracker over a manual clock; `heading` is what the next settled read finds. */
function tracked() {
  const clock = manualClock();
  const logged: string[] = [];
  let heading: string | null = null;
  const tracker = createHeadingScrollTracker({ timers: clock, onHeading: (text) => { logged.push(text); } });
  const scroll = (): void => { tracker.scrolled(() => heading); };
  return { clock, logged, scroll, setHeading: (next: string | null) => { heading = next; } };
}

void test("a heading is logged once scrolling settles, not on every scroll", async (t) => {
  const { clock, logged, scroll, setHeading } = tracked();
  setHeading("Intro");
  for (let i = 0; i < 20; i++) { scroll(); await clock.advance(100); }
  t.check(logged, []);
  await clock.advance(1_000);
  t.check(logged, ["Intro"]);
});

void test("only a changed heading is logged again", async (t) => {
  const { clock, logged, scroll, setHeading } = tracked();
  setHeading("Intro");
  scroll(); await clock.advance(1_000);
  scroll(); await clock.advance(1_000);
  setHeading("Moles and mass");
  scroll(); await clock.advance(1_000);
  setHeading(null);
  scroll(); await clock.advance(1_000);
  setHeading("Intro");
  scroll(); await clock.advance(1_000);
  t.check(logged, ["Intro", "Moles and mass", "Intro"]);
});

void test("without headings nothing is logged", async (t) => {
  const { clock, logged, scroll } = tracked();
  scroll(); await clock.advance(2_000);
  t.check(logged, []);
});
