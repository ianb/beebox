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
  BookmarkSchema,
  ImageSchema,
  AudioSchema,
  CaptureSessionSchema,
  RecordSchema,
  RecipeSchema,
  NewsJobSchema,
  IntakeJobSchema,
  CalendarReviewJobSchema,
  QuestionFollowupJobSchema,
  GuideSchema,
  ScheduledScriptSchema,
} from "./registry.js";

// Re-export individual schema types
export type { Memo, MemoStatus } from "./memo.js";
export type { Question, QuestionStatus, QuestionInputType } from "./question.js";
export type { NewsItem, NewsItemStatus } from "./news-item.js";
export type { NewsSummary, NewsSummaryStatus } from "./news-summary.js";
export type { NewsBrief } from "./news-brief.js";
export type { NewsGuide } from "./news-guide.js";
export type { Feedback } from "./feedback.js";
export type { Bookmark } from "./bookmark.js";
export type { Image, ImageStatus } from "./image.js";
export type { Audio, AudioStatus } from "./audio.js";
export type { CaptureSession, CaptureSessionStatus } from "./capture-session.js";
export type { Record, RecordStatus } from "./record.js";
export type { Recipe } from "./recipe.js";
export type { NewsJob } from "./news-job.js";
export type { IntakeJob } from "./intake-job.js";
export type { CalendarReviewJob } from "./calendar-review-job.js";
export type { QuestionFollowupJob } from "./question-followup-job.js";
export type { Guide } from "./guide.js";
export type { ScheduledScript, ParsedScheduledScript, ScheduleCheckContext } from "./scheduled-script.js";

// Re-export template functions
export { createMemoTemplate, createVoiceMemoTemplate } from "./memo.js";
export {
  createSelectQuestionTemplate,
  createTextQuestionTemplate,
  createConfirmQuestionTemplate,
} from "./question.js";
export { createNewsItemTemplate } from "./news-item.js";
export { createNewsSummaryTemplate } from "./news-summary.js";
export { createBookmarkTemplate } from "./bookmark.js";
export { createImageTemplate } from "./image.js";
export { createAudioTemplate } from "./audio.js";
export { createCaptureSessionTemplate } from "./capture-session.js";
export { createRecordTemplate } from "./record.js";
export { createRecipeTemplate } from "./recipe.js";
export { createNewsJobTemplate } from "./news-job.js";
export { createIntakeJobTemplate } from "./intake-job.js";
export { createCalendarReviewJobTemplate } from "./calendar-review-job.js";
export { createQuestionFollowupJobTemplate } from "./question-followup-job.js";

// Guide exports
export { parseGuide, compileGuide, createInitialGuideTemplate } from "./guide.js";
export type { ParsedGuide } from "./guide.js";

// Scheduled script exports
export {
  parseScheduledScript,
  parseDuration,
  isDue,
  isDueForWakeup,
  createScheduledScriptTemplate,
} from "./scheduled-script.js";

// Re-export template registry
export {
  registerTemplate,
  getTemplate,
  getDefaultTemplate,
  getTemplateNames,
  getAllTemplates,
  getTemplatesForCardType,
  describeTemplateArgs,
  type TemplateDefinition,
} from "./templates.js";
