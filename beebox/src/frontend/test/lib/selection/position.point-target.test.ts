// Point mode chooses rendered document content for the existing chat selection.
// It must exclude controls inside a block and describe non-text images.
import "../../helpers/dom-globals.js";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { extractPointSelection, extractTranscriptPointSelection, pointTarget } from "../../../src/lib/selection/position.js";

void test("a link inside a Markdown paragraph chooses the paragraph", async (t) => {
  const root = document.createElement("div");
  root.innerHTML = '<h2 id="notes">Notes</h2><div class="bbx-paragraph">Review the <a href="/next"><span>report</span></a> today.</div>';
  const span = root.querySelector("span");
  if (span === null) throw new Error("fixture span missing");
  const target = pointTarget(span, root);
  t.check(target?.className, "bbx-paragraph");
  t.check(target === null ? null : extractPointSelection(target, root), {
    text: "Review the report today.",
    position: "heading: Notes (#notes); paragraph 1",
  });
});

void test("a code block's Copy button is not part of the quote", async (t) => {
  const root = document.createElement("div");
  root.innerHTML = '<pre><button type="button">Copy</button><code>if ready:\n  save("a  b")</code></pre>';
  const copy = root.querySelector("button");
  if (copy === null) throw new Error("fixture button missing");
  const target = pointTarget(copy, root);
  t.check(target, null);
  const pre = root.querySelector("pre");
  t.check(pre === null ? null : extractPointSelection(pre, root), {
    text: "if ready:\n  save(\"a  b\")",
    position: "",
  });
});

void test("a line break stays between the quoted lines", async (t) => {
  const root = document.createElement("div");
  root.innerHTML = "<p>First line<br>Second line</p>";
  const paragraph = root.querySelector("p");
  if (paragraph === null) throw new Error("fixture paragraph missing");
  t.check(extractPointSelection(paragraph, root), {
    text: "First line\nSecond line",
    position: "paragraph 1",
  });
});

void test("an image uses its caption when it has no alt text", async (t) => {
  const root = document.createElement("div");
  root.innerHTML = '<figure><img src="/chart.png" alt=""><figcaption>Sales by month</figcaption></figure>';
  const image = root.querySelector("img");
  if (image === null) throw new Error("fixture image missing");
  const target = pointTarget(image, root);
  t.check(target?.tagName, "IMG");
  t.check(target === null ? null : extractPointSelection(target, root), {
    text: "Image: Sales by month",
    position: "element: img",
  });
});

void test("the image inside a lightbox button remains selectable", async (t) => {
  const root = document.createElement("div");
  root.innerHTML = '<button aria-label="Chart (click to zoom)"><img data-image-src="/chart.png" src="/chart.png" alt="Monthly chart"></button>';
  const image = root.querySelector("img");
  if (image === null) throw new Error("fixture image missing");
  const target = pointTarget(image, root);
  t.check(target?.tagName, "IMG");
  t.check(target === null ? null : extractPointSelection(target, root), {
    text: "Image: Monthly chart", position: "element: img",
  });
});

void test("a plain user message is a point target", async (t) => {
  const root = document.createElement("div");
  root.innerHTML = '<div data-role="user"><div data-point-block="">A message from me.</div></div>';
  const text = root.querySelector("[data-point-block]")?.firstChild;
  if (text === undefined || text === null) throw new Error("fixture message missing");
  const target = pointTarget(text, root);
  t.check(target?.getAttribute("data-point-block"), "");
  t.check(target === null ? null : extractTranscriptPointSelection(target, root), {
    text: "A message from me.", position: "chat transcript; user message",
  });
});

// Transcript point capture retains the same quote, but identifies its speaker.
void test("a transcript point identifies the containing message", async (t) => {
  const root = document.createElement("div");
  root.innerHTML = '<div data-role="assistant"><p>A response.</p></div>';
  const paragraph = root.querySelector("p");
  if (paragraph === null) throw new Error("fixture paragraph missing");
  t.check(extractTranscriptPointSelection(paragraph, root), {
    text: "A response.", position: "chat transcript; assistant message",
  });
});
