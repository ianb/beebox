/**
 * The three Jev question types (Noul, Choice, Score) as one judgment: several
 * named questions over one state, sent in one Decisions API call. The wire
 * shapes follow OpenRouter's Decisions API (docs/plans/notifications.md,
 * "Prior art"): a `noul` answer is `{ noul: p }`; a `choice` answer is
 * `{ choice, confidence, probabilities }`; a `score` answer is `{ score,
 * confidence, probabilities, legend }`.
 *
 * Responses are checked as strictly as `parseJevResponse`: a missing or extra
 * question, an unknown option, or a distribution that does not sum to one is
 * a `JevError`, never a partial answer.
 */

import { isRecord } from "../lib/is-record.js";
import { JEV_MODEL, JEV_PROVIDER, probability, responseError } from "./jev-wire.js";

export type JudgeInstructions = string | string[];

export type JudgeQuestion =
  | { type: "noul"; instructions: JudgeInstructions; criteria: { true: string; false: string } }
  | { type: "choice"; instructions: JudgeInstructions; criteria: Record<string, string> }
  | { type: "score"; instructions: JudgeInstructions; criteria: string[] };

export interface JudgeInput {
  /** Whose box this is and what it is for; sent first in every question's instructions. */
  situation?: string | undefined;
  /** Instructions shared by every question, after the situation. */
  instructions: JudgeInstructions;
  questions: Record<string, JudgeQuestion>;
  state: unknown;
}

export type JudgeAnswer =
  | { type: "noul"; probability: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };

export interface JudgeResult {
  model: string;
  answers: Record<string, JudgeAnswer>;
}

function lines(value: JudgeInstructions): string[] {
  return typeof value === "string" ? [value] : value;
}

/** One question's instructions: the situation, the shared instructions, then its own. */
function questionInstructions(input: JudgeInput, question: JudgeQuestion): string[] {
  const situation = input.situation === undefined || input.situation.trim() === "" ? [] : [input.situation];
  return [...situation, ...lines(input.instructions), ...lines(question.instructions)];
}

/** Exact wire representation of a judgment request. */
export function serializeJudgeRequest(input: JudgeInput): string {
  const questions = Object.fromEntries(
    Object.entries(input.questions).map(([name, question]) => [
      name,
      { type: question.type, instructions: questionInstructions(input, question), criteria: question.criteria },
    ]),
  );
  return JSON.stringify({ model: JEV_MODEL, provider: JEV_PROVIDER, state: input.state, questions });
}

/** Keys of the distribution a question must return, or the level count for a score. */
function expectedKeys(question: JudgeQuestion): string[] | number {
  switch (question.type) {
    case "noul":
      return [];
    case "choice":
      return Object.keys(question.criteria);
    case "score":
      return question.criteria.length;
  }
}

/** A complete, rounded distribution: every value a probability, the total within rounding of one. */
function distribution(value: unknown, opts: { name: string; keys: string[] | number }): Record<string, number> {
  const { name, keys } = opts;
  if (!isRecord(value)) throw responseError(`question "${name}" returned no probabilities`);
  const got = Object.keys(value);
  const count = typeof keys === "number" ? keys : keys.length;
  if (count === 0 || got.length !== count || (typeof keys !== "number" && got.some((key) => !keys.includes(key)))) {
    throw responseError(`question "${name}" distribution keys did not match its ${String(count)} options`);
  }
  const entries: [string, number][] = [];
  for (const key of typeof keys === "number" ? got : keys) {
    const p = value[key];
    if (!probability(p)) throw responseError(`question "${name}" has an invalid probability`);
    entries.push([key, p]);
  }
  const total = entries.reduce((sum, [, p]) => sum + p, 0);
  // Same rounding allowance as parseJevResponse: at most two percentage points.
  const tolerance = Math.min(0.02, count * 0.005 + 0.000001);
  if (Math.abs(total - 1) > tolerance) {
    throw responseError(`question "${name}" probabilities summed to ${String(total)}`);
  }
  return Object.fromEntries(entries);
}

function confidenceOf(answer: Record<string, unknown>, name: string): number {
  const confidence = answer["confidence"];
  if (!probability(confidence)) throw responseError(`question "${name}" has an invalid confidence`);
  return confidence;
}

function parseAnswer(raw: unknown, opts: { name: string; question: JudgeQuestion }): JudgeAnswer {
  const { name, question } = opts;
  if (!isRecord(raw) || raw["type"] !== question.type) {
    throw responseError(`question "${name}" answer is missing or not a ${question.type}`);
  }
  const keys = expectedKeys(question);
  switch (question.type) {
    case "noul": {
      const p = raw["noul"];
      if (!probability(p)) throw responseError(`question "${name}" has an invalid noul probability`);
      return { type: "noul", probability: p };
    }
    case "choice": {
      const choice = raw["choice"];
      if (typeof choice !== "string" || !(choice in question.criteria)) {
        throw responseError(`question "${name}" chose an option it was not offered`);
      }
      const probabilities = distribution(raw["probabilities"], { name, keys });
      return { type: "choice", choice, confidence: confidenceOf(raw, name), probabilities };
    }
    case "score": {
      const score = raw["score"];
      if (typeof score !== "number" || !Number.isFinite(score)) {
        throw responseError(`question "${name}" has an invalid score`);
      }
      const probabilities = distribution(raw["probabilities"], { name, keys });
      return { type: "score", score, confidence: confidenceOf(raw, name), probabilities };
    }
  }
}

/** Parse a Decisions API response for `questions`; every question answered, nothing extra. */
export function parseJudgeResponse(body: unknown, questions: Record<string, JudgeQuestion>): JudgeResult {
  const model = isRecord(body) ? body["model"] : undefined;
  const answers = isRecord(body) ? body["answers"] : undefined;
  const names = Object.keys(questions);
  if (typeof model !== "string" || !model.trim() || !isRecord(answers)) {
    throw responseError(`missing model or answers for ${String(names.length)} questions`);
  }
  const got = Object.keys(answers);
  if (names.length === 0 || got.length !== names.length || got.some((key) => !names.includes(key))) {
    throw responseError(`answers did not match the ${String(names.length)} requested questions`);
  }
  const parsed: Record<string, JudgeAnswer> = {};
  for (const [name, question] of Object.entries(questions)) {
    parsed[name] = parseAnswer(answers[name], { name, question });
  }
  return { model, answers: parsed };
}

/** An answer in its wire shape: what the fake feeds back through {@link parseJudgeResponse}. */
export function answerToWire(answer: JudgeAnswer): Record<string, unknown> {
  switch (answer.type) {
    case "noul":
      return { type: "noul", noul: answer.probability };
    case "choice":
    case "score":
      return { ...answer };
  }
}

/** The fake's default: no opinion. Noul 0.5; choice and score uniform over their options. */
export function uncertainAnswer(question: JudgeQuestion): JudgeAnswer {
  switch (question.type) {
    case "noul":
      return { type: "noul", probability: 0.5 };
    case "choice": {
      const keys = Object.keys(question.criteria);
      const probabilities = Object.fromEntries(keys.map((key) => [key, 1 / keys.length]));
      return { type: "choice", choice: keys[0] ?? "", confidence: 0, probabilities };
    }
    case "score": {
      const count = question.criteria.length;
      const probabilities = Object.fromEntries(question.criteria.map((_level, index) => [String(index), 1 / count]));
      return { type: "score", score: Math.floor(count / 2), confidence: 0, probabilities };
    }
  }
}
