/**
 * The decision after a judgment: basic conditions over Jev's answers, combined
 * with AND. A judgment is not a decision (docs/implemented-plans/notifications.md, Track
 * D): `bbx judge`'s `--min`, `--choice`, and `--decide` make it, and `jq` over
 * the JSON output is the escape hatch.
 *
 * A condition's key is a question name, or `name.option` for one option of a
 * choice or score question (a score's options are its level numbers, from 0):
 *
 * - noul `name`: `min`/`max` bound the probability of yes.
 * - choice `name`: `is` names the option Jev chose.
 * - score `name`: `min`/`max` bound the score; `is` is an exact level.
 * - `name.option`: `min`/`max` bound that option's probability.
 */

import { z } from "zod";
import type { JudgeAnswer, JudgeQuestion } from "../../services/jev-judge.js";

export interface Condition {
  key: string;
  min?: number | undefined;
  max?: number | undefined;
  is?: string | number | undefined;
}

/** A condition that cannot apply to the card's questions; the message says why (exit 2). */
export class ConditionError extends Error {
  constructor({ key, rule }: { key: string; rule: string }) {
    super(`${key}: ${rule}`);
    this.name = "ConditionError";
  }
}

const Probability = z.number().min(0).max(1);

const DecideJson = z.record(
  z.string(),
  z.strictObject({ min: z.number().optional(), max: z.number().optional(), is: z.union([z.string(), z.number()]).optional() }),
);

/** `name=p` or `name.option=p` from `--min`. */
export function parseMinFlag(flag: string): Condition {
  const eq = flag.lastIndexOf("=");
  const key = flag.slice(0, eq);
  const p = Probability.safeParse(Number(flag.slice(eq + 1)));
  if (eq <= 0 || flag.slice(eq + 1).trim() === "" || !p.success) {
    throw new ConditionError({ key: `--min ${flag}`, rule: "write name=p or name.option=p with p between 0 and 1" });
  }
  return { key, min: p.data };
}

/** `name=option` from `--choice`. */
export function parseChoiceFlag(flag: string): Condition {
  const eq = flag.indexOf("=");
  if (eq <= 0 || eq === flag.length - 1) throw new ConditionError({ key: `--choice ${flag}`, rule: "write name=option" });
  return { key: flag.slice(0, eq), is: flag.slice(eq + 1) };
}

/** The `--decide` JSON: `{ name: { min?, max?, is? } }`. */
export function parseDecideFlag(json: string): Condition[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (_e) {
    // The parse error adds nothing the rule below does not say.
    throw new ConditionError({ key: "--decide", rule: "not JSON; write {\"name\": {\"min\": p, \"max\": p, \"is\": option}}" });
  }
  const parsed = DecideJson.safeParse(raw);
  if (!parsed.success) throw new ConditionError({ key: "--decide", rule: "each key maps to {min?, max?, is?}" });
  return Object.entries(parsed.data).map(([key, bounds]) => ({ key, ...bounds }));
}

function splitKey(key: string): { name: string; option: string | undefined } {
  const dot = key.indexOf(".");
  return dot === -1 ? { name: key, option: undefined } : { name: key.slice(0, dot), option: key.slice(dot + 1) };
}

function optionsOf(question: JudgeQuestion): string[] {
  switch (question.type) {
    case "noul":
      return [];
    case "choice":
      return Object.keys(question.criteria);
    case "score":
      return question.criteria.map((_level, index) => String(index));
  }
}

/** A probability bound (a noul, or `name.option`) lies in 0..1; a score's level bound does not. */
function checkProbabilityBounds({ key, min, max }: Condition): void {
  for (const [label, bound] of [["min", min], ["max", max]] as const) {
    if (bound !== undefined && !Probability.safeParse(bound).success) {
      throw new ConditionError({ key, rule: `${label} ${bound} is a probability, between 0 and 1` });
    }
  }
}

/** Check each condition against the card's questions before any call; throws {@link ConditionError}. */
export function checkConditions(conditions: readonly Condition[], questions: Record<string, JudgeQuestion>): void {
  for (const condition of conditions) {
    const { key, min, max, is } = condition;
    const { name, option } = splitKey(key);
    const question = questions[name];
    if (question === undefined) throw new ConditionError({ key: key, rule: `the card has no question "${name}" (it has ${Object.keys(questions).join(", ")})` });
    if (min === undefined && max === undefined && is === undefined) throw new ConditionError({ key: key, rule: "give min, max, or is" });
    if (option !== undefined) {
      if (question.type === "noul") throw new ConditionError({ key: key, rule: "a noul has no options; bound its probability as the bare name" });
      if (!optionsOf(question).includes(option)) throw new ConditionError({ key: key, rule: `"${option}" is not one of ${optionsOf(question).join(", ")}` });
      if (is !== undefined) throw new ConditionError({ key: key, rule: "an option takes min and max (its probability), not is" });
      checkProbabilityBounds(condition);
      continue;
    }
    switch (question.type) {
      case "noul":
        if (is !== undefined) throw new ConditionError({ key: key, rule: "a noul takes min and max (its probability), not is" });
        checkProbabilityBounds(condition);
        break;
      case "choice":
        if (min !== undefined || max !== undefined) throw new ConditionError({ key: key, rule: "a choice takes is (the chosen option); bound an option's probability as name.option" });
        if (!optionsOf(question).includes(String(is))) throw new ConditionError({ key: key, rule: `"${String(is)}" is not one of ${optionsOf(question).join(", ")}` });
        break;
      case "score":
        if (is !== undefined && !optionsOf(question).includes(String(is))) throw new ConditionError({ key: key, rule: `level ${String(is)} is not one of ${optionsOf(question).join(", ")}` });
        break;
    }
  }
}

function within(value: number, { min, max }: Condition): boolean {
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}

function holds(condition: Condition, answers: Record<string, JudgeAnswer>): boolean {
  const { name, option } = splitKey(condition.key);
  const answer = answers[name];
  if (answer === undefined) return false;
  if (option !== undefined) {
    if (answer.type === "noul") return false;
    return within(answer.probabilities[option] ?? 0, condition);
  }
  switch (answer.type) {
    case "noul":
      return within(answer.probability, condition);
    case "choice":
      return answer.choice === String(condition.is);
    case "score":
      return within(answer.score, condition) && (condition.is === undefined || String(answer.score) === String(condition.is));
  }
}

/** Whether every condition holds. No conditions: every judged state passes. */
export function passes(conditions: readonly Condition[], answers: Record<string, JudgeAnswer>): boolean {
  return conditions.every((condition) => holds(condition, answers));
}
