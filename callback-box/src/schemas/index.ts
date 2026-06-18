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
  FeedbackSchema,
  ImageSchema,
  AudioSchema,
  FileSchema,
  CaptureSessionSchema,
  RecordSchema,
  RecipeSchema,
  IntakeJobSchema,
  CalendarReviewJobSchema,
  QuestionFollowupJobSchema,
  GuideSchema,
  ScheduledScriptSchema,
  TelegramMessageSchema,
  ChatThreadSchema,
  ChatJobSchema,
  TodoListSchema,
  SheetSchema,
  LandmarkSchema,
} from "./registry.js";

// Re-export individual schema types
export type { MemoFields, MemoStatusType } from "./memo.js";
export type { QuestionFields, QuestionStatusType, QuestionInputTypeValue } from "./question.js";
export type { FeedbackFields } from "./feedback.js";
export type { ImageFields, ImageStatus } from "./image.js";
export type { AudioFields, AudioStatus } from "./audio.js";
export type { FileFields, FileStatus } from "./file.js";
export type { CaptureSession, CaptureSessionStatus } from "./capture-session.js";
export type { RecordFields, RecordStatus } from "./record.js";
export type { RecipeFields } from "./recipe.js";
export type { IntakeJobFields } from "./intake-job.js";
export type { CalendarReviewJobFields } from "./calendar-review-job.js";
export type { QuestionFollowupJobFields } from "./question-followup-job.js";
export type { Guide } from "./guide.js";
export type { ScheduledScriptFields, ParsedScheduledScript, ScheduleCheckContext } from "./scheduled-script.js";
export type { TelegramMessageFields } from "./telegram-message.js";
export type { ChatThreadFields, ChatThreadEntry, ChatThreadMessage, ChatThreadSeen } from "./chat-thread.js";
export type { ChatJobFields } from "./chat-job.js";
export type { TodoListFields, TodoItem, TodoItemStatusType } from "./todo-list.js";
export type { SheetFields } from "./sheet.js";
export type { DocFields } from "./doc.js";
export type { GdocFields, GdocLossyType } from "./gdoc.js";
export type { Landmark } from "./landmark.js";

// Re-export template functions
export { createMemoTemplate, createVoiceMemoTemplate } from "./memo.js";
export {
  createSelectQuestionTemplate,
  createTextQuestionTemplate,
  createConfirmQuestionTemplate,
} from "./question.js";
export { createImageTemplate } from "./image.js";
export { createAudioTemplate } from "./audio.js";
export { createFileTemplate } from "./file.js";
export { createCaptureSessionTemplate } from "./capture-session.js";
export { createRecordTemplate } from "./record.js";
export { createRecipeTemplate } from "./recipe.js";
export { createIntakeJobTemplate } from "./intake-job.js";
export { createCalendarReviewJobTemplate } from "./calendar-review-job.js";
export { createQuestionFollowupJobTemplate } from "./question-followup-job.js";
export { createTelegramMessageTemplate } from "./telegram-message.js";
export { createChatThreadTemplate, createMessageEntry } from "./chat-thread.js";
export { createChatJobTemplate } from "./chat-job.js";
export { createTodoListTemplate } from "./todo-list.js";
export { createSheetTemplate } from "./sheet.js";
export { createLandmarkTemplate, parseLandmarkFields } from "./landmark.js";
export type {
  LandmarkFields,
  LandmarkNavigationData,
  LandmarkDestinationData,
} from "./landmark.js";
export { createDocTemplate } from "./doc.js";
export { createGdocTemplate } from "./gdoc.js";

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
