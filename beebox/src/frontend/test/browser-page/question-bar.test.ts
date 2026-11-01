// # The question bar's script, in a document
//
// docs/plans/shared-browser-ask.subplan.md. The script runs in a happy-dom
// window with `fetch` substituted. Keys typed in the bar must not reach the
// dashboard, which would send them to the page in the browser. A question can
// quote a page, so its markup must show as text. Typed words must survive a
// poll. When there is nothing left to press, the words stay until closed.

// First, and bare: the script needs the happy-dom window.
import "../helpers/dom-harness.js";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { runInThisContext } from "node:vm";
import { QUESTION_BAR_SCRIPT } from "../../../webapp/routes/browser/proxy/question-bar.js";

interface Call { url: string; body: unknown }

const calls: Call[] = [];
let questions: { id: string; text: string; pageUrl?: string }[] = [{ id: "q1", text: 'Solve <img src=x onerror="boom()"> please', pageUrl: "https://shop.example/check" }];
let answerStatus = 200;
let answerHold: Promise<void> | null = null;

Reflect.set(globalThis, "fetch", async (url: string, init?: RequestInit) => {
  calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
  const isAnswer = url.endsWith("/answer");
  if (isAnswer && answerHold !== null) await answerHold;
  return new Response(JSON.stringify(isAnswer ? { error: "gone" } : { questions }), { status: isAnswer ? answerStatus : 200 });
});

// The script's timer would hold the test open; a poll is the same refresh as coming back to the tab.
const realSetInterval = globalThis.setInterval;
Reflect.set(globalThis, "setInterval", () => 0);
runInThisContext(QUESTION_BAR_SCRIPT);
Reflect.set(globalThis, "setInterval", realSetInterval);
document.dispatchEvent(new Event("DOMContentLoaded"));

function poll(): void {
  document.dispatchEvent(new Event("visibilitychange"));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function bar(): HTMLElement {
  const found = document.getElementById("bbx-question-bar");
  if (found === null) throw new Error("no bar");
  return found;
}

function shown(): string[] {
  return [...bar().querySelectorAll("p")].map((p) => p.textContent ?? "");
}

function buttons(): string[] {
  return [...bar().querySelectorAll("button")].map((b) => b.textContent ?? "");
}

function press(label: string): void {
  bar().querySelectorAll("button")[buttons().indexOf(label)]?.click();
}

void test("The bar shows the question as text, hanging from <html>", async (t) => {
  await settle();
  t.check(bar().parentElement?.tagName, "HTML");
  t.check(bar().hidden, false);
  t.check(bar().querySelector("p")?.textContent, 'Solve <img src=x onerror="boom()"> please');
  t.check(bar().querySelector("img"), null);
  t.check(bar().querySelector("small")?.textContent, "About https://shop.example/check");
});

void test("Keys typed in the bar reach no page listener; keys elsewhere do", (t) => {
  let seen = 0;
  document.addEventListener("keydown", () => { seen += 1; });
  bar().querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  t.check(seen, 0);
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  t.check(seen, 1);
  t.end();
});

void test("Typed words survive a poll, and a new question joins without a redraw", async (t) => {
  const box = bar().querySelector("textarea");
  if (box === null) throw new Error("no box");
  box.value = "it keeps looping";
  questions = [...questions, { id: "q2", text: "Second" }];
  poll();
  await settle();
  t.check(bar().querySelector("textarea")?.value, "it keeps looping");
  t.check(shown(), ['Solve <img src=x onerror="boom()"> please', "Second"]);
  questions = questions.slice(0, 1);
  poll();
  await settle();
  t.check(shown(), ['Solve <img src=x onerror="boom()"> please']);
});

// The route takes the question off the list while it sends, so a poll sees it gone.
void test("A poll during a send does not drop the words", async (t) => {
  const saved = questions;
  questions = [];
  answerStatus = 502;
  let release: () => void = () => {};
  answerHold = new Promise((resolve) => { release = resolve; });
  press("Not done");
  poll();
  await settle();
  t.check(bar().querySelector("textarea")?.value, "it keeps looping");
  questions = saved;
  answerHold = null;
  release();
  await settle();
});

void test("A failed send keeps the words and lets the person press again", async (t) => {
  t.check(calls.find((c) => c.url.endsWith("/answer"))?.body, { id: "q1", outcome: "not-done", text: "it keeps looping" });
  t.check(bar().querySelector("[role=status]")?.textContent, "gone");
  t.check(bar().querySelector("textarea")?.value, "it keeps looping");
  t.check(buttons(), ["Done", "Not done"]);
  t.check(bar().querySelector("button")?.disabled, false);
});

void test("A gone chat leaves the words on screen until closed", async (t) => {
  answerStatus = 410;
  press("Done");
  questions = [];
  await settle();
  poll();
  await settle();
  t.check(bar().hidden, false);
  t.check(bar().querySelector("textarea")?.value, "it keeps looping");
  t.check(buttons(), ["Close"]);
  press("Close");
  t.check(bar().hidden, true);
});

void test("A delivered answer clears the row", async (t) => {
  questions = [{ id: "q3", text: "Third" }];
  poll();
  await settle();
  answerStatus = 200;
  press("Done");
  questions = [];
  await settle();
  t.check(bar().hidden, true);
});
