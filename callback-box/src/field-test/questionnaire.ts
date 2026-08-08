/**
 * The post-activity questionnaire debrief (`docs/plans/agent-field-tests.md`,
 * Track 3).
 *
 * After the operator finishes an activity — never before, so the questions
 * cannot prime the behaviour they ask about — the harness asks a fixed set of
 * questions plus whatever the scenario item added. Answers are free markdown,
 * stored verbatim. Exactly one question is constrained (`smooth | friction |
 * blocked`) because the report table needs a column; its answer is parsed
 * tolerantly and an unparseable one becomes `unresolved`, never an exception:
 * a debrief that throws would lose the eight good answers next to the bad one.
 *
 * The asking is a callback (`ask`), not a session: this module owns the
 * questions, the re-ask rule and the parsing, and knows nothing about the SDK.
 */

import * as path from "node:path";
import { fileExists } from "../lib/file-exists.js";

/** The one constrained answer, plus the sentinel for an unparseable one. */
export type ActivityOutcome = "smooth" | "friction" | "blocked";
export type ParsedOutcome = ActivityOutcome | "unresolved";

const OUTCOME_WORDS: readonly ActivityOutcome[] = ["smooth", "friction", "blocked"];

export interface QuestionnaireQuestion {
  /** Stable id — the key answers are recorded under in the report. */
  id: string;
  /** Sent to the operator verbatim. */
  text: string;
  /**
   * `free` answers are stored as-is; the single `outcome` question's answer is
   * additionally parsed into an `ActivityOutcome`.
   */
  kind: "free" | "outcome";
}

/**
 * The standard nine. Ordered so the constrained question is last: everything
 * before it is recall, and the one-word summary should come after the operator
 * has re-read its own experience, not before. The `rendering` question is
 * deliberately low-trust by design: the operator's visual judgment is not
 * relied on — its flags are collected WITH screenshots for a human to vet
 * (report writers surface them as unvetted visual flags, never as findings).
 */
export const STANDARD_QUESTIONS: readonly QuestionnaireQuestion[] = [
  {
    id: "accomplished",
    kind: "free",
    text: "Did you accomplish what you set out to do? How do you know — what did you actually see that told you so?",
  },
  {
    id: "first-attempt",
    kind: "free",
    text: "What did you try first, and why did that look like the right thing? If it didn't work, what did you fall back to?",
  },
  {
    id: "hesitations",
    kind: "free",
    text: "Walk me through anywhere you hesitated, backtracked, or guessed. What were you unsure about at each point?",
  },
  {
    id: "surprises",
    kind: "free",
    text: "What surprised you, or seemed wrong or broken?",
  },
  {
    id: "missing",
    kind: "free",
    text: "What did you expect to exist that didn't?",
  },
  {
    id: "wording",
    kind: "free",
    text: "Was there any wording — a label, a button, a message — you didn't understand? Quote it exactly.",
  },
  {
    id: "rendering",
    kind: "free",
    text: "Did anything LOOK visually off or badly rendered — clipped, overlapping, squashed, misaligned, unstyled, broken images, content cut off? List every suspect, each with the screenshot that shows it. Flag things you are unsure about too — a person will vet these from your screenshots, so a false alarm is cheap and a miss is not.",
  },
  {
    id: "screenshots",
    kind: "free",
    text: "Which of your screenshots show the things you just described? List them by filename and say what each one shows.",
  },
  {
    id: "outcome",
    kind: "outcome",
    text: "Overall, was this smooth, friction, or blocked? Answer with exactly one of those three words on its own first line, then explain why.",
  },
];

/**
 * The standard questions with a scenario item's extra questions inserted before
 * the constrained one, so the one-word summary stays last.
 */
export function debriefQuestions(extras: readonly string[]): QuestionnaireQuestion[] {
  const free = STANDARD_QUESTIONS.filter((q) => q.kind === "free");
  const constrained = STANDARD_QUESTIONS.filter((q) => q.kind === "outcome");
  const extraQuestions: QuestionnaireQuestion[] = extras.map((text, i) => ({
    id: `extra-${String(i + 1)}`,
    kind: "free",
    text,
  }));
  return [...free, ...extraQuestions, ...constrained];
}

export interface OutcomeParse {
  outcome: ParsedOutcome;
  /** Why the answer was unresolved, or null when it parsed. */
  reason: string | null;
}

/** Words that can flip the sense of an outcome word elsewhere in the answer. */
const NEGATIONS = new Set(["not", "no", "never", "nor", "neither", "without", "hardly"]);
const CONTRACTED_NOT = /n['’]t\b/;

/**
 * Parse the constrained answer. Tolerant on purpose — the operator is writing
 * prose, so "Blocked." and "blocked — I never found it" both count — but it
 * does not guess. An answer that leads with one of the three words is taken at
 * its word. Otherwise a single mention counts only if nothing in the answer
 * negates it, because "it was not blocked" must never be reported as `blocked`;
 * anything else is `unresolved`, which is a worse-looking report row and a far
 * better one than a wrong outcome.
 */
export function parseOutcome(answer: string): OutcomeParse {
  const lowered = answer.toLowerCase();
  const words = lowered.split(/[^a-z]+/).filter((w) => w.length > 0);
  if (words.length === 0) return { outcome: "unresolved", reason: "answer was empty" };

  const first = OUTCOME_WORDS.find((w) => w === words[0]);
  if (first !== undefined) return { outcome: first, reason: null };

  const mentioned = OUTCOME_WORDS.filter((w) => words.includes(w));
  if (mentioned.length === 0) {
    return { outcome: "unresolved", reason: "answer named none of smooth/friction/blocked" };
  }
  if (mentioned.length > 1) {
    return {
      outcome: "unresolved",
      reason: `answer named several of smooth/friction/blocked (${mentioned.join(", ")}) and did not lead with one`,
    };
  }
  if (words.some((w) => NEGATIONS.has(w)) || CONTRACTED_NOT.test(lowered)) {
    return {
      outcome: "unresolved",
      reason: "answer did not lead with an outcome word and its single mention may be negated",
    };
  }
  const only = mentioned[0];
  if (only === undefined) return { outcome: "unresolved", reason: "answer was empty" };
  return { outcome: only, reason: null };
}

export interface ScreenshotRef {
  /** Filename as the operator wrote it, reduced to its basename. */
  filename: string;
  /** Whether that file exists in the run's screenshots directory. */
  resolved: boolean;
}

// No spaces in the class on purpose: "step-2.png and step-3.jpg" must be two
// refs, not one. A path is matched from its last separator on, which is all the
// basename below needs.
const SCREENSHOT_PATTERN = /[\w.@-]+\.(?:png|jpe?g|webp)/gi;

/**
 * Every image filename mentioned anywhere in the answers, checked against the
 * screenshots directory. A missing one is recorded, never thrown: the operator
 * citing evidence that does not exist is precisely the fabrication signal the
 * report wants to show, so it has to survive into the report.
 */
export async function verifyScreenshotRefs(
  answers: readonly string[],
  screenshotsDir: string,
): Promise<ScreenshotRef[]> {
  const names = new Set<string>();
  for (const answer of answers) {
    for (const match of answer.matchAll(SCREENSHOT_PATTERN)) {
      names.add(path.basename(match[0].trim()));
    }
  }
  const refs: ScreenshotRef[] = [];
  for (const filename of [...names].toSorted()) {
    refs.push({ filename, resolved: await fileExists(path.join(screenshotsDir, filename)) });
  }
  return refs;
}

export interface QuestionAnswer {
  id: string;
  question: string;
  /** Verbatim, un-trimmed beyond whitespace at the ends. */
  answer: string;
  /** True when the first reply was empty and the question was asked again. */
  reAsked: boolean;
}

export interface DebriefResult {
  answers: QuestionAnswer[];
  outcome: ParsedOutcome;
  /** Why the outcome is unresolved, or null. */
  outcomeReason: string | null;
  /** Ids of questions still unanswered after the single re-ask. */
  unanswered: string[];
  screenshotRefs: ScreenshotRef[];
  /** Cited screenshots that do not exist — a harness finding, not an error. */
  missingScreenshots: string[];
}

export interface RunQuestionnaireOptions {
  questions: readonly QuestionnaireQuestion[];
  /** Ask one question and return the operator's reply. */
  ask: (question: string) => Promise<string>;
  /** Where the operator's screenshots are written. */
  screenshotsDir: string;
}

const RE_ASK_PREFIX =
  "You left that unanswered. Please answer it, in your own words, from what you saw:\n\n";

/**
 * Ask the questions one at a time. One question per message rather than one
 * message holding all of them: the plan's re-ask rule needs to know *which*
 * question was skipped, and splitting a single prose reply back into N answers
 * is exactly the fragile parsing this tier should not depend on.
 */
export async function runQuestionnaire(options: RunQuestionnaireOptions): Promise<DebriefResult> {
  const { questions, ask, screenshotsDir } = options;
  const answers: QuestionAnswer[] = [];
  const unanswered: string[] = [];
  let outcome: ParsedOutcome = "unresolved";
  let outcomeReason: string | null = "the outcome question was not asked";

  for (const question of questions) {
    let answer = (await ask(question.text)).trim();
    let reAsked = false;
    if (answer === "") {
      reAsked = true;
      answer = (await ask(RE_ASK_PREFIX + question.text)).trim();
    }
    if (answer === "") unanswered.push(question.id);
    answers.push({ id: question.id, question: question.text, answer, reAsked });
    if (question.kind === "outcome") {
      const parsed = parseOutcome(answer);
      outcome = parsed.outcome;
      outcomeReason = parsed.reason;
    }
  }

  const screenshotRefs = await verifyScreenshotRefs(answers.map((a) => a.answer), screenshotsDir);
  return {
    answers,
    outcome,
    outcomeReason,
    unanswered,
    screenshotRefs,
    missingScreenshots: screenshotRefs.filter((r) => !r.resolved).map((r) => r.filename),
  };
}
