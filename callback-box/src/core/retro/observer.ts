/**
 * The retrospective observer — one tool-less LLM pass per chat session,
 * extracting what the boxholder implicitly taught the assistant.
 *
 * Behind an interface so the scan pipeline is doctestable with a
 * scripted fake (the project's standard real + fake service split).
 */

import { createAgent } from "../agent.js";
import {
  ObserverOutputSchema,
  type SessionObservation,
} from "./observations.js";

export interface ObserveArgs {
  sessionId: string;
  /** Compact transcript rendering (see render.ts). */
  transcript: string;
}

export interface RetroObserver {
  /** Extract observations from one session. Throws on observer failure. */
  observe(args: ObserveArgs): Promise<SessionObservation[]>;
}

/** Default model for observation passes — cheap tier; quality is judged
 * by reading run reports, revisit if it under-extracts. */
const DEFAULT_OBSERVER_MODEL = "haiku";
/** Hard per-session cost ceiling. */
const MAX_BUDGET_USD = 0.25;

const OBSERVER_SYSTEM_PROMPT = `You are the retrospective observer for a personal-assistant box. You read one chat transcript between the boxholder and their assistant and extract what the boxholder implicitly taught the assistant.

Report an observation ONLY when the transcript actually shows it:

- correction — the boxholder corrected the assistant's behavior, tone, or output
- preference — a stated or demonstrated preference about how things should be done
- register — evidence of the boxholder's preferred tone, formality, or verbosity
- recurring-ask — a request that looks like a standing need rather than a one-off
- context-gap — the assistant had to ask about (or guessed wrong on) something its briefing should have answered
- experiment-evidence — behavior bearing on an active personality or guide experiment

Rules:
- evidence must be a LITERAL QUOTE copied from the transcript — the boxholder's words where possible, never a paraphrase.
- proposal is one sentence: what belief or rule this evidence suggests.
- sink says where the belief belongs: personality (tone/traits/relationship), guide (a domain rule — set sinkRef to the guide card path if the transcript makes it clear), briefing (missing situational context), question (needs the boxholder's explicit confirmation).
- Do not use any tools. Work only from the transcript in this prompt.
- Do not invent observations. An empty list is the common, correct result for routine conversations.`;

class ObserverRunError extends Error {
  constructor(sessionId: string, detail: string) {
    super(`retro observer failed for session ${sessionId}: ${detail}`);
    this.name = "ObserverRunError";
  }
}

/**
 * Real observer: a fresh single-purpose agent per session, structured
 * output validated against the observation schema.
 */
export function createSdkRetroObserver(options: {
  boxRoot: string;
  model?: string;
}): RetroObserver {
  const model = options.model ?? DEFAULT_OBSERVER_MODEL;
  return {
    async observe(args: ObserveArgs): Promise<SessionObservation[]> {
      const agent = createAgent({ name: `retro-observer:${args.sessionId}` });
      const result = await agent.invokeStructured(ObserverOutputSchema, {
        boxRoot: options.boxRoot,
        systemPrompt: OBSERVER_SYSTEM_PROMPT,
        prompt: `Session ${args.sessionId}. Transcript follows.\n\n${args.transcript}`,
        model,
        maxTurns: 4,
        maxBudgetUsd: MAX_BUDGET_USD,
      });
      if (!result.success || result.data === null) {
        throw new ObserverRunError(args.sessionId, result.error || "no structured output");
      }
      return result.data.observations;
    },
  };
}
