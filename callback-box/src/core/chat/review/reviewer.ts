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
 * conversation. See docs/plans/chat-review.md § Why incremental.
 */

import { z } from "zod";
import { createAgent } from "../../agent/index.js";

/** Husk titles stay bookmark-sized. Matches TITLE_MAX_LEN in core/chat/husk.ts. */
export const TITLE_MAX = 80;
/** `contains` stays inside the lint budget (core/card-lint.ts CONTAINS_MAX_CHARS). */
export const CONTAINS_MAX = 200;
/** Account items before the model must merge the least durable ones. */
export const NOTES_MAX = 40;
/** One account item stays a line, not an essay. */
export const NOTE_MAX = 280;

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

/** Cheap tier; quality is judged by reading real output, revisit if it under-performs. */
const DEFAULT_REVIEWER_MODEL = "haiku";
/** Hard per-session cost ceiling. */
const MAX_BUDGET_USD = 0.25;

export const REVIEWER_SYSTEM_PROMPT = `You read one chat conversation between a person (the "boxholder") and their personal assistant, and you write down what it amounts to: a title, a one-sentence summary, and a short account of what came of it.

You are usually shown only the NEW part of a conversation you have summarized before, together with the account you wrote last time. Extend that account: carry items forward, revise them when the new material changes them, drop them when they are resolved and no longer worth keeping, and add what is new. Do not re-derive the account from scratch — the earlier conversation is not in front of you, and your previous account is the only record of it.

## The title

The title is how someone finds this conversation again in a list. It must be:

- Information-dense and specific to THIS chat — distinguishable from the person's other conversations.
- One line, sentence case, no trailing period, roughly 4-9 words.
- Written for a SEMI-PUBLIC audience. This is the hard part, so read it twice:

Chat lists show up in places the conversation itself never does — on a shared screen, in a screenshot, over someone's shoulder. Write the title as if read by someone standing behind the boxholder who is not entitled to the details.

- Name the SUBJECT AND SHAPE of the conversation, not its contents. "Sorting out a recurring billing problem" — not the vendor, the amount, or the account.
- For health, money, relationships, legal matters, employment, or anything the boxholder framed as private: name the CATEGORY at most. Never the particulars. Never the other people involved.
- Never include: names of people other than the boxholder, amounts, diagnoses, addresses, account numbers, order numbers, or any other identifier.
- Still make it findable. "A personal matter" is discreet but useless — it fails the job. Where discretion and distinctiveness genuinely conflict, discretion wins, and the title should say plainly that it is a private matter of some particular kind.

Return an EMPTY title string when the existing title still describes the conversation. Titles that churn every night make the list unstable to read, so change one only when it no longer fits.

## contains

One sentence stating what can be found in this conversation. Same audience and same discretion rules as the title — it feeds search and listings, so it is more exposed, not less.

## The account (notes)

Each item is one line, kinded:
- decision — something settled
- open-thread — something raised and unresolved
- follow-up — something the boxholder or assistant meant to do
- learned — something durable about the boxholder, their situation, or their preferences

Rules:
- Report only what the conversation actually shows. DO NOT INVENT. An empty list is the common and correct result for a routine conversation.
- The account is git-tracked and pushed off the machine, so the "no third-party names, no identifiers" rule applies here too.
- Do not use any tools. Work only from the text in this prompt.`;

class ReviewerRunError extends Error {
  constructor(sessionId: string, detail: string) {
    super(`chat reviewer failed for session ${sessionId}: ${detail}`);
    this.name = "ReviewerRunError";
  }
}

/** Assemble the per-session user prompt: prior state first, then the new span. */
export function buildReviewPrompt(args: ReviewArgs): string {
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
  const model = options.model ?? DEFAULT_REVIEWER_MODEL;
  return {
    async review(args: ReviewArgs): Promise<ReviewOutput> {
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
