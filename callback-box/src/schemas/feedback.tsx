/**
 * Feedback card schema — user feedback on editions.
 *
 * Feedback cards capture user responses to:
 * - Query prompts in editions (text or voice)
 * - Comments on specific sections/expandos (text or voice)
 *
 * Voice feedback works like voice memos — the same transcribe
 * pre-action handles them via `source: voice` + audio attachment.
 * Transcribed text ends up in `transcription.text`; the markdown
 * body holds the user's text response when given typed (rather
 * than spoken).
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../cards/index.js";

export const FeedbackType = z.enum(["query-response", "comment", "brief"]);
export type FeedbackTypeValue = z.infer<typeof FeedbackType>;

export const FeedbackSource = z.enum(["text", "voice"]);
export type FeedbackSourceValue = z.infer<typeof FeedbackSource>;

const TargetEntry = z.object({ ref: z.string() });

const TranscriptionEntry = z.object({
  language: z.string().optional(),
  "transcribed-at": z.string().datetime({ offset: true }).optional(),
  text: z.string(),
});

const TranscriptionError = z.object({
  permanent: z.boolean(),
  code: z.string().optional(),
  "attempted-at": z.string().datetime({ offset: true }).optional(),
  message: z.string(),
});

export const FeedbackSchema: CardSchema = cardSchema("feedback", {
  fields: {
    "type-of-feedback": FeedbackType.optional(),
    target: TargetEntry,
    source: FeedbackSource,
    timestamp: z.string().datetime({ offset: true }),
    transcription: TranscriptionEntry.optional(),
    "transcription-error": TranscriptionError.optional(),
    body: body(z.string()),
  },
  instructions: `# Feedback Cards

Feedback cards capture user responses inside the box.

Frontmatter:
- \`type-of-feedback:\` — \`query-response\`, \`comment\`, or \`brief\`.
- \`target:\` — \`{ref}\` pointing at the target element. The ref uses
  the cardworks \`path#fragment\` form, e.g.
  \`store/briefings/2026-02-01.briefing.card#q1\`.
- \`source:\` — \`text\` or \`voice\`.
- \`timestamp:\` — when the feedback was submitted.
- \`transcription:\` — populated by the transcribe pre-action for
  voice feedback. \`{text, language?, transcribed-at?}\`.
- \`transcription-error:\` — set if transcription failed.

Body (markdown): the user's typed text. For voice feedback the body
may be empty; \`transcription.text\` is the source of truth.`,
});

export interface FeedbackFields {
  type: "feedback";
  "type-of-feedback"?: FeedbackTypeValue;
  target: { ref: string };
  source: FeedbackSourceValue;
  timestamp: string;
  transcription?: { text: string; language?: string; "transcribed-at"?: string };
  "transcription-error"?: {
    permanent: boolean;
    code?: string;
    "attempted-at"?: string;
    message: string;
  };
  body: string;
}

export function createFeedbackTemplate(options: {
  typeOfFeedback?: FeedbackTypeValue;
  targetRef: string;
  source: FeedbackSourceValue;
  text?: string;
  timestamp?: string;
}): string {
  const fields: Record<string, unknown> = {
  };
  if (options.typeOfFeedback !== undefined) {
    fields["type-of-feedback"] = options.typeOfFeedback;
  }
  fields["target"] = { ref: options.targetRef };
  fields["source"] = options.source;
  fields["timestamp"] = options.timestamp === undefined
    ? new Date().toISOString()
    : options.timestamp;
  const yamlText = stringifyYaml(fields);
  const bodyText = options.text === undefined ? "" : options.text;
  const bodyTail = bodyText === ""
    ? ""
    : `${bodyText}${bodyText.endsWith("\n") ? "" : "\n"}`;
  return `---\n${yamlText}---\n${bodyTail}`;
}
