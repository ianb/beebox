/**
 * The Jev service `bbx judge` calls, and the debug log every call leaves.
 *
 * - `BBX_JEV_FAKE=1` / `=0`: a fake with a fixed confident yes / no, so a dev
 *   box runs a judgment pipeline end to end with no key (the `BBX_NOTIFY_FAKE`
 *   precedent, docs/plans/notifications.md "Testability").
 * - Otherwise the box's OpenRouter key, read the way quick chat reads it;
 *   none means `unconfigured`.
 *
 * `.beebox/jev-debug.log` gets one JSON line per call, with the state (and a
 * whole-stdin input, which is the state) truncated and never the key: the record for learning what a judgment card
 * does with real states.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createFakeJev, createJevService, type JevService } from "../../services/jev.js";
import type { JudgeAnswer, JudgeQuestion } from "../../services/jev-judge.js";
import { getOpenRouterKey } from "../openrouter.js";

/** A state longer than this is cut in the debug log. */
const LOGGED_STATE_CHARS = 500;

export const JEV_FAKE_ENV = "BBX_JEV_FAKE";

/** A confident fixed answer: yes is noul 1, the first option, the top level; no is the reverse. */
export function fixedAnswer(question: JudgeQuestion, { yes }: { yes: boolean }): JudgeAnswer {
  switch (question.type) {
    case "noul":
      return { type: "noul", probability: yes ? 1 : 0 };
    case "choice": {
      const keys = Object.keys(question.criteria);
      const choice = (yes ? keys[0] : keys.at(-1)) ?? "";
      return { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? 1 : 0])) };
    }
    case "score": {
      const score = yes ? question.criteria.length - 1 : 0;
      const probabilities = Object.fromEntries(question.criteria.map((_level, index) => [String(index), index === score ? 1 : 0]));
      return { type: "score", score, confidence: 1, probabilities };
    }
  }
}

export type JudgeServiceResult =
  | { kind: "ready"; jev: JevService; fake: boolean }
  | { kind: "unconfigured" }
  | { kind: "bad-fake"; value: string };

/** The service for this run: the env fake, or the box's OpenRouter key. */
export async function resolveJudgeService(boxRoot: string, env: NodeJS.ProcessEnv): Promise<JudgeServiceResult> {
  const fake = env[JEV_FAKE_ENV];
  if (fake !== undefined && fake !== "") {
    if (fake !== "1" && fake !== "0") return { kind: "bad-fake", value: fake };
    const yes = fake === "1";
    return { kind: "ready", fake: true, jev: createFakeJev({ answers: (_name, { question }) => fixedAnswer(question, { yes }) }) };
  }
  const granted = await getOpenRouterKey(boxRoot, { purpose: "bbx-judge" });
  if (granted === null) return { kind: "unconfigured" };
  return { kind: "ready", fake: false, jev: createJevService({ apiKey: granted }) };
}

export interface JevDebugEntry {
  at: string;
  card: string;
  input: string;
  state: string;
  fake?: boolean;
  model?: string;
  answers?: Record<string, JudgeAnswer>;
  passed?: boolean;
  error?: string;
}

/** Append one call to `.beebox/jev-debug.log`; a write failure warns and never fails the judgment. */
export async function appendJevDebug(boxRoot: string, entry: JevDebugEntry): Promise<void> {
  const logPath = path.join(boxRoot, ".beebox", "jev-debug.log");
  const cut = (text: string): string => (text.length > LOGGED_STATE_CHARS ? `${text.slice(0, LOGGED_STATE_CHARS)}… (${String(text.length)} chars)` : text);
  const state = cut(entry.state);
  const input = cut(entry.input);
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify({ ...entry, input, state })}\n`);
  } catch (e) {
    console.warn("[judge] could not write jev-debug.log:", e);
  }
}
