/**
 * The chat reviewer — one tool-less LLM pass per session span, producing a
 * title, a one-sentence `contains`, and the running account.
 *
 * Behind an interface so the run pipeline is doctestable with a scripted fake
 * (the project's standard real + fake service split, as `RetroObserver` does).
 *
 * The pass is incremental: the model receives the account it wrote last time
 * plus **only the new span**, and returns the whole updated account. It never
 * re-reads the conversation from the top, because `renderSessionCompact` elides
 * the middle of anything over 40k chars and most sessions long enough to review
 * are past that — a from-scratch re-read would quietly drop the middle of the
 * conversation. See docs/implemented-plans/chat-review.md § Why incremental.
 */

import { z } from "zod";
import { createAgent } from "../../agent/index.js";
import { loadEffectiveSmallModel } from "../../model-policy.js";

/** Husk titles stay bookmark-sized. Matches TITLE_MAX_LEN in core/chat/husk.ts. */
const TITLE_MAX = 80;
/** `contains` stays inside the lint budget (core/card-lint.ts CONTAINS_MAX_CHARS). */
const CONTAINS_MAX = 200;
/** Account items before the model must merge the least durable ones. */
const NOTES_MAX = 40;
/** One account item stays a line, not an essay. */
const NOTE_MAX = 280;

export const ReviewOutputSchema = z.object({
  /** One line. Empty string means "the existing title still fits, keep it". */
  title: z
    .string()
    .max(TITLE_MAX)
    .refine((t) => !t.includes("\n"), { message: "title must be a single line" }),
  /** One sentence naming what can be found in this conversation. */
  contains: z.string().min(1).max(CONTAINS_MAX),
  /**
   * The FULL updated account — prior items carried forward, revised or dropped,
   * plus whatever the new span adds. Whole rather than a delta because a new
   * span can resolve an open thread or reverse a decision, which an
   * append-only format could not express.
   */
  notes: z
    .array(
      z.object({
        kind: z.enum(["decision", "open-thread", "follow-up", "learned"]),
        text: z.string().min(1).max(NOTE_MAX),
      }),
    )
    .max(NOTES_MAX),
});

export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export interface ReviewArgs {
  sessionId: string;
  /** The title the husk currently carries, or null when it has none. */
  currentTitle: string | null;
  /** The account from the last pass, or null on the first (bootstrap) pass. */
  currentAccount: string | null;
  /** Rendered new span (already elided if oversized). */
  span: string;
  /** True when `span` is the whole transcript rather than an increment. */
  bootstrap: boolean;
}

export interface ChatReviewer {
  /** Review one span. Throws on reviewer failure. */
  review(args: ReviewArgs): Promise<ReviewOutput>;
}


/** Hard per-session cost ceiling. */
const MAX_BUDGET_USD = 0.25;

const REVIEWER_SYSTEM_PROMPT = `You read one chat conversation between a person (the "boxholder") and their personal assistant, and you write down what it amounts to: a title, a one-sentence summary, and a short account of what came of it.

You are usually shown only the NEW part of a conversation you have summarized before, together with the account you wrote last time. Extend that account: carry items forward, revise them when the new material changes them, drop them when they are resolved and no longer worth keeping, and add what is new. Do not re-derive the account from scratch — the earlier conversation is not in front of you, and your previous account is the only record of it.

## The title — the one place to hold back

Everything else you write (contains, the account) should be as explicit and
specific as it needs to be to be useful. They are the record of the conversation.
Do not sanitize them, do not omit names, figures, or specifics. Being vague there
destroys the thing's value.

The title is different, for one reason: titles appear in lists, and lists get read
in contexts the conversation never anticipated — on a shared screen, over the
boxholder's shoulder, in a screenshot.

So the question is NOT "is this private?" It is: **would the boxholder wince if
someone standing nearby read this title?**

That is a much narrower bar than privacy, and the narrowness is the point:

- **Names, dates, places, amounts and specifics are all FINE.** "Road trip to Keene, July 8-11" is a good title. "Indigo's custodial account paperwork" is a good title. Do NOT strip these — they are what makes a title findable again, and removing them costs real value while protecting nothing.
- **What to avoid is the wince.** Health problems and symptoms. Money trouble. Conflict with a named person. Anything intimate or sexual. Anything that reflects badly on the boxholder or on someone else. Anything revealing a judgement about a person ("her memory is going"). A diagnosis, a firing, a debt, a falling-out.
- When the conversation genuinely IS about one of those, name its **shape rather than its sting** — "A hard family conversation about care" rather than the condition and whose it is. Enough to find it again; not enough to embarrass anyone read cold.
- **Most conversations need none of this.** Work, logistics, research, planning, errands: just write the clear specific title. Holding back is an exception you invoke when the subject warrants it, not a filter you run over everything.

The title must also be:

- Information-dense and specific to THIS chat — distinguishable from the person's other conversations.
- One line, sentence case, no trailing period, roughly 4-9 words.
- Findable. "A personal matter" protects nothing anyone cared about and destroys the title's only job.
- A human-readable label, not a data dump. No email addresses, URLs, file paths, account or order numbers, ids, or long numbers — not because they are sensitive, but because they read as noise in a list and crowd out the words that help someone recognise the conversation. If such a detail matters, it belongs in contains or the account.

Return an EMPTY title string when the existing title still describes the conversation. Titles that churn every night make the list unstable to read, so change one only when it no longer fits.

## contains

One sentence stating what can be found in this conversation. Be specific and concrete — name the actual subject, the actual property, the actual question. This is a retrieval and recall aid, not a public label; the discretion rules above apply to the TITLE ONLY and must not be carried over here. A vague summary here is a useless one.

## The account (notes)

Each item is one line, kinded:
- decision — something settled
- open-thread — something raised and unresolved
- follow-up — something the boxholder or assistant meant to do
- learned — something durable about the boxholder, their situation, or their preferences

Rules:
- Report only what the conversation actually shows. DO NOT INVENT. An empty list is the common and correct result for a routine conversation.
- Be concrete. Names, amounts, dates, decisions, specifics — record what was actually said and settled. This is the durable record of a conversation whose transcript will eventually be deleted, so anything you leave out is lost. The title's discretion rules do NOT apply here.
- Do not use any tools. Work only from the text in this prompt.`;

class ReviewerRunError extends Error {
  constructor(sessionId: string, detail: string) {
    super(`chat reviewer failed for session ${sessionId}: ${detail}`);
    this.name = "ReviewerRunError";
  }
}

/** Assemble the per-session user prompt: prior state first, then the new span. */
function buildReviewPrompt(args: ReviewArgs): string {
  const parts: string[] = [];
  parts.push(
    args.currentTitle === null
      ? "This conversation has no title yet."
      : `Current title: ${args.currentTitle}`,
  );
  parts.push(
    args.currentAccount === null
      ? "You have not summarized this conversation before."
      : `The account you wrote last time:\n\n${args.currentAccount}`,
  );
  parts.push(
    args.bootstrap
      ? "What follows is the whole conversation so far. If it is long, its middle may be elided."
      : "What follows is only the NEW part of the conversation since you last looked.",
  );
  parts.push(args.span);
  return parts.join("\n\n");
}

/** Real reviewer: a fresh single-purpose agent per session, structured output. */
export function createSdkChatReviewer(options: {
  boxRoot: string;
  model?: string;
}): ChatReviewer {
  return {
    async review(args: ReviewArgs): Promise<ReviewOutput> {
      // Resolved per run, not at construction: it is an engine-aware lookup,
      // and the box's small-model slot is the only thing that may name it.
      const model = options.model ?? await loadEffectiveSmallModel(options.boxRoot);
      const agent = createAgent({ name: `chat-review:${args.sessionId}` });
      const result = await agent.invokeStructured(ReviewOutputSchema, {
        boxRoot: options.boxRoot,
        systemPrompt: REVIEWER_SYSTEM_PROMPT,
        prompt: buildReviewPrompt(args),
        model,
        maxTurns: 4,
        maxBudgetUsd: MAX_BUDGET_USD,
      });
      if (!result.success) {
        throw new ReviewerRunError(args.sessionId, result.error);
      }
      return result.data;
    },
  };
}
