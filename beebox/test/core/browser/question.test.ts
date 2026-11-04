// # What the agent waits for in the box browser
//
// docs/plans/shared-browser-ask.subplan.md. A chat has at most one question
// waiting, so a chat's new ask replaces its own and leaves another chat's alone.
// A question is claimed once. One whose answer failed comes back, unless its
// chat has asked again. A corrupt file reads as nothing waiting. The answer's
// chat message carries what the person pressed, then their words.

import t from "tap";
import type { Test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerMessage, askBrowserQuestion, claimBrowserQuestion, readBrowserQuestions, restoreBrowserQuestion } from "../../../src/core/browser/question.js";

const now = new Date("2026-10-31T12:00:00Z");

async function root(st: Test): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bbx-q-"));
  st.teardown(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

void t.test("A chat's new ask replaces only its own", async (st) => {
  const dir = await root(st);
  st.check(readBrowserQuestions(dir), []);
  st.check(askBrowserQuestion(dir, { question: "first", sessionId: "a", pageUrl: "https://shop.example/x", now }), { replaced: false, pageUrl: "https://shop.example/x" });
  st.check(askBrowserQuestion(dir, { question: "other", sessionId: "b", pageUrl: "about:blank", now }), { replaced: false, pageUrl: null });
  st.check(askBrowserQuestion(dir, { question: "second", sessionId: "a", pageUrl: "https://shop.example/y", now }), { replaced: true, pageUrl: "https://shop.example/y" });
  // about:blank is not a page to reopen.
  st.check(readBrowserQuestions(dir).map((q) => [q.sessionId, q.question, q.pageUrl]), [
    ["b", "other", null],
    ["a", "second", "https://shop.example/y"],
  ]);
});

void t.test("A question is claimed once, and a failed answer puts it back", async (st) => {
  const dir = await root(st);
  askBrowserQuestion(dir, { question: "q", sessionId: "a", pageUrl: "about:blank", now });
  const id = readBrowserQuestions(dir)[0]?.id ?? "";
  const claimed = claimBrowserQuestion(dir, id);
  st.check(claimed?.question, "q");
  st.check(claimBrowserQuestion(dir, id), null);
  if (claimed === null) return;
  restoreBrowserQuestion(dir, claimed);
  st.check(readBrowserQuestions(dir).map((q) => q.id), [id]);

  // The chat asked again while the answer was failing: the newer question stands.
  claimBrowserQuestion(dir, id);
  askBrowserQuestion(dir, { question: "newer", sessionId: "a", pageUrl: "about:blank", now });
  restoreBrowserQuestion(dir, claimed);
  st.check(readBrowserQuestions(dir).map((q) => q.question), ["newer"]);

  // Put back between two others, it keeps its place by age.
  const older = claimBrowserQuestion(dir, readBrowserQuestions(dir)[0]?.id ?? "");
  if (older === null) return;
  askBrowserQuestion(dir, { question: "later", sessionId: "b", pageUrl: "about:blank", now: new Date("2026-10-31T13:00:00Z") });
  restoreBrowserQuestion(dir, older);
  st.check(readBrowserQuestions(dir).map((q) => q.question), ["newer", "later"]);
});

void t.test("A corrupt file reads as nothing waiting, and the next ask overwrites it", async (st) => {
  const dir = await root(st);
  await writeFile(join(dir, "questions.json"), "{not json");
  const original = console.warn;
  let warnings = 0;
  console.warn = () => { warnings += 1; };
  st.teardown(() => { console.warn = original; });
  st.check(readBrowserQuestions(dir), []);
  st.check(warnings, 1);
  askBrowserQuestion(dir, { question: "q", sessionId: "a", pageUrl: "about:blank", now });
  st.check(readBrowserQuestions(dir).map((q) => q.question), ["q"]);
});

void t.test("The answer's message is what was pressed, then the person's words", async (st) => {
  st.check(answerMessage({ outcome: "done" }), '<typed source="browser-tab">Done</typed>');
  st.check(answerMessage({ outcome: "done", text: "  " }), '<typed source="browser-tab">Done</typed>');
  st.check(answerMessage({ outcome: "not-done" }), '<typed source="browser-tab">Not done</typed>');
  st.check(answerMessage({ outcome: "not-done", text: "it keeps looping" }), '<typed source="browser-tab">Not done: it keeps looping</typed>');
});
