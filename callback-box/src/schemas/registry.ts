/**
 * Central schema registration with cardworks.
 *
 * All card schemas are registered here and exported for use
 * by the CardLoader factory.
 */

import { SchemaRegistry, type ElementSchema } from "cardworks";
import { MemoSchema } from "./memo.js";
import { QuestionSchema } from "./question.js";
import { NewsItemSchema } from "./news-item.js";
import { NewsSummarySchema } from "./news-summary.js";
import { NewsBriefSchema } from "./news-brief.js";
import { NewsGuideSchema } from "./news-guide.js";
import { FeedbackSchema } from "./feedback.js";
import { WorkflowSchema } from "./workflow.js";
import { WorkflowRunSchema } from "./workflow-run.js";
import { BookmarkSchema } from "./bookmark.js";
import { ImageSchema } from "./image.js";
import { AudioSchema } from "./audio.js";
import { CaptureSessionSchema } from "./capture-session.js";
import { RecordSchema } from "./record.js";
import { RecipeSchema } from "./recipe.js";
import { EmailThreadSchema } from "./email-thread.js";
import { EmailMessageSchema } from "./email-message.js";
import { NewsJobSchema } from "./news-job.js";
import { GuideRevisionJobSchema } from "./guide-revision-job.js";
import { IntakeJobSchema } from "./intake-job.js";
import { CalendarReviewJobSchema } from "./calendar-review-job.js";

/**
 * All registered card schemas.
 */
export const schemas: ElementSchema[] = [
  MemoSchema,
  QuestionSchema,
  NewsItemSchema,
  NewsSummarySchema,
  NewsBriefSchema,
  NewsGuideSchema,
  FeedbackSchema,
  WorkflowSchema,
  WorkflowRunSchema,
  BookmarkSchema,
  ImageSchema,
  AudioSchema,
  CaptureSessionSchema,
  RecordSchema,
  RecipeSchema,
  EmailThreadSchema,
  EmailMessageSchema,
  NewsJobSchema,
  GuideRevisionJobSchema,
  IntakeJobSchema,
  CalendarReviewJobSchema,
];

/**
 * Create a SchemaRegistry populated with all known schemas.
 */
export function createSchemaRegistry(): SchemaRegistry {
  const registry = new SchemaRegistry();
  for (const schema of schemas) {
    registry.register(schema);
  }
  return registry;
}

/**
 * Get the list of known card types.
 */
export function getCardTypes(): string[] {
  return schemas.map(s => s.tagName);
}

/**
 * Check if a card type is known.
 */
export function isKnownCardType(type: string): boolean {
  return schemas.some(s => s.tagName === type);
}

// Re-export individual schemas for direct access
export { MemoSchema } from "./memo.js";
export { QuestionSchema } from "./question.js";
export { NewsItemSchema } from "./news-item.js";
export { NewsSummarySchema } from "./news-summary.js";
export { NewsBriefSchema } from "./news-brief.js";
export { NewsGuideSchema } from "./news-guide.js";
export { FeedbackSchema } from "./feedback.js";
export { WorkflowSchema } from "./workflow.js";
export { WorkflowRunSchema } from "./workflow-run.js";
export { BookmarkSchema } from "./bookmark.js";
export { ImageSchema } from "./image.js";
export { AudioSchema } from "./audio.js";
export { CaptureSessionSchema } from "./capture-session.js";
export { RecordSchema } from "./record.js";
export { RecipeSchema } from "./recipe.js";
export { EmailThreadSchema } from "./email-thread.js";
export { EmailMessageSchema } from "./email-message.js";
export { NewsJobSchema } from "./news-job.js";
export { GuideRevisionJobSchema } from "./guide-revision-job.js";
export { IntakeJobSchema } from "./intake-job.js";
export { CalendarReviewJobSchema } from "./calendar-review-job.js";
