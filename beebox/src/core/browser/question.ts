/**
 * What the agent is waiting for the person to do in the box browser
 * (docs/plans/shared-browser-ask.subplan.md).
 *
 * `bbx browser ask` saves a question; the Browser page shows it in its question
 * bar; the person's answer goes to the chat that asked. A chat has at most one
 * question waiting, and a new ask from that chat replaces it. The list lives
 * beside the browser's profile, outside the box's git repository.
 *
 * Every change here is a synchronous read and write. The engine is one process,
 * so two requests cannot interleave inside one: of two presses on one question,
 * exactly one claims it.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomicSync } from "../../lib/atomic-write.js";
import { errnoCode } from "../../shared/error-guards.js";

const QUESTION_MAX_CHARS = 2000;

export const ASK_BODY = z.object({
  question: z.string().trim().min(1, "the question is empty").max(QUESTION_MAX_CHARS, `the question is over ${String(QUESTION_MAX_CHARS)} characters`),
  sessionId: z.string().min(1),
});

export const ANSWER_BODY = z.object({
  id: z.string().min(1),
  outcome: z.enum(["done", "not-done"]),
  text: z.string().optional(),
});
export type AnswerOutcome = z.infer<typeof ANSWER_BODY>["outcome"];

const BROWSER_QUESTION = z.object({
  id: z.string(),
  question: z.string(),
  sessionId: z.string(),
  /** The page the agent was on, reopened if the browser idles out first. */
  pageUrl: z.string().nullable(),
  askedAt: z.string(),
});
export type BrowserQuestion = z.infer<typeof BROWSER_QUESTION>;

function questionsFile(browserRoot: string): string {
  return path.join(browserRoot, "questions.json");
}

/** The waiting questions, oldest first. A corrupt file reads as none; the next ask overwrites it. */
export function readBrowserQuestions(browserRoot: string): BrowserQuestion[] {
  const file = questionsFile(browserRoot);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  try {
    return z.array(BROWSER_QUESTION).parse(JSON.parse(text));
  } catch (e) {
    console.warn(`[browser] ignoring unreadable ${file}:`, e instanceof Error ? e.message : String(e));
    return [];
  }
}

function writeQuestions(browserRoot: string, questions: readonly BrowserQuestion[]): void {
  writeFileAtomicSync(questionsFile(browserRoot), { content: `${JSON.stringify(questions, null, 2)}\n` });
}

/** The URL to keep for `url`: only a real web page can be reopened. */
function reopenableUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Save a question for the person. Answers whether it replaced this chat's earlier one. */
export function askBrowserQuestion(
  browserRoot: string,
  input: { question: string; sessionId: string; pageUrl: string; now: Date },
): { replaced: boolean } {
  const questions = readBrowserQuestions(browserRoot);
  const others = questions.filter((q) => q.sessionId !== input.sessionId);
  writeQuestions(browserRoot, [...others, {
    id: randomUUID(),
    question: input.question,
    sessionId: input.sessionId,
    pageUrl: reopenableUrl(input.pageUrl),
    askedAt: input.now.toISOString(),
  }]);
  return { replaced: others.length !== questions.length };
}

/** Remove the question `id` and return it, or null when it is no longer waiting. */
export function claimBrowserQuestion(browserRoot: string, id: string): BrowserQuestion | null {
  const questions = readBrowserQuestions(browserRoot);
  const claimed = questions.find((q) => q.id === id);
  if (claimed === undefined) return null;
  writeQuestions(browserRoot, questions.filter((q) => q.id !== id));
  return claimed;
}

/** Put back a claimed question whose answer could not be sent, unless its chat has since asked another. */
export function restoreBrowserQuestion(browserRoot: string, question: BrowserQuestion): void {
  const questions = readBrowserQuestions(browserRoot);
  if (questions.some((q) => q.sessionId === question.sessionId)) return;
  writeQuestions(browserRoot, [...questions, question]);
}

/** The chat message for an answer: the person's words, after what they pressed. */
export function answerMessage({ outcome, text }: { outcome: AnswerOutcome; text?: string | undefined }): string {
  const label = outcome === "done" ? "Done" : "Not done";
  const words = text?.trim() ?? "";
  return `<typed source="browser-tab">${words === "" ? label : `${label}: ${words}`}</typed>`;
}
