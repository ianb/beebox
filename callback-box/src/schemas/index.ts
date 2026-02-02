/**
 * Schema module - exports all schemas and registry utilities.
 */

// Re-export everything from the registry
export {
  schemas,
  createSchemaRegistry,
  getCardTypes,
  isKnownCardType,
  MemoSchema,
  QuestionSchema,
  NewsItemSchema,
  NewsSummarySchema,
  NewsBriefSchema,
  NewsGuideSchema,
  FeedbackSchema,
} from "./registry.js";

// Re-export individual schema types
export type { Memo, MemoStatus } from "./memo.js";
export type { Question, QuestionStatus, QuestionInputType } from "./question.js";
export type { NewsItem, NewsItemStatus } from "./news-item.js";
export type { NewsSummary, NewsSummaryStatus } from "./news-summary.js";
export type { NewsBrief } from "./news-brief.js";
export type { NewsGuide } from "./news-guide.js";
export type { Feedback } from "./feedback.js";

// Re-export template functions
export { createMemoTemplate, createVoiceMemoTemplate } from "./memo.js";
export {
  createSelectQuestionTemplate,
  createTextQuestionTemplate,
  createConfirmQuestionTemplate,
} from "./question.js";
export { createNewsItemTemplate } from "./news-item.js";
export { createNewsSummaryTemplate } from "./news-summary.js";

// Re-export template registry
export {
  registerTemplate,
  getTemplate,
  getTemplateNames,
  getAllTemplates,
  getTemplatesForCardType,
  describeTemplateArgs,
  type TemplateDefinition,
} from "./templates.js";
