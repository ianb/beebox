/**
 * Schema module - exports all schemas and registry utilities.
 */

// Registry utilities
export { getCardTypes, isKnownCardType } from "./registry.js";

// Individual schemas, from their own modules
export { MemoSchema } from "./memo.js";
export { QuestionSchema } from "./question.js";
export { FeedbackSchema } from "./feedback.js";
export { ImageSchema } from "./image.js";
export { AudioSchema } from "./audio.js";
export { FileSchema } from "./file.js";
export { PdfSchema } from "./pdf.js";
export { CaptureSessionSchema } from "./capture-session.js";
export { UploadBatchSchema } from "./upload-batch.js";
export { RecordSchema } from "./record.js";
export { RecipeSchema } from "./recipe.js";
export { IntakeJobSchema } from "./intake-job.js";
export { QuestionFollowupJobSchema } from "./question-followup-job.js";
export { GuideSchema } from "./guide.js";
export { ScheduledScriptSchema } from "./scheduled-script.js";
export { TelegramMessageSchema } from "./telegram-message.js";
export { ChatThreadSchema } from "./chat-thread.js";
export { ChatJobSchema } from "./chat-job.js";
export { TodoViewSchema } from "./todo-view.js";
export { GsheetSchema } from "./gsheet.js";
export { LandmarkSchema } from "./landmark.js";
export { QuestionsSchema } from "./questions.js";
export { LandmarksSchema } from "./landmarks.js";
export { HistorySchema } from "./history.js";
export { InventorySchema } from "./inventory.js";
export { AdminSchema } from "./admin.js";

// Re-export individual schema types
export type { MemoFields, MemoStatusType } from "./memo.js";
export type { QuestionFields, QuestionStatusType, QuestionInputTypeValue } from "./question.js";
export type { FeedbackFields } from "./feedback.js";
export type { ImageFields, ImageStatus } from "./image.js";
export type { AudioFields, AudioStatus } from "./audio.js";
export type { FileFields, FileStatus } from "./file.js";
export type { PdfFields, PdfStatusType } from "./pdf.js";
export type { CaptureSession, CaptureSessionStatus } from "./capture-session.js";
export type { UploadBatchFrontmatter, UploadBatchStatus } from "./upload-batch.js";
export type { RecordFields, RecordStatus } from "./record.js";
export type { RecipeFields } from "./recipe.js";
export type { IntakeJobFields } from "./intake-job.js";
export type { QuestionFollowupJobFields } from "./question-followup-job.js";
export type { Guide } from "./guide.js";
export type { ScheduledScriptFields, ParsedScheduledScript, ScheduleCheckContext } from "./scheduled-script.js";
export type { TelegramMessageFields } from "./telegram-message.js";
export type { ChatThreadFields, ChatThreadEntry, ChatThreadMessage, ChatThreadSeen } from "./chat-thread.js";
export type { ChatJobFields } from "./chat-job.js";
export type { TodoViewFields } from "./todo-view.js";
export type { GsheetFields } from "./gsheet.js";
export type { DocFields } from "./doc.js";
export type { GdocFields, GdocLossyType } from "./gdoc.js";
export type { GfolderFields } from "./gfolder.js";
export type { GlinkFields, GlinkOriginType } from "./glink.js";
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
export { createPdfTemplate } from "./pdf.js";
export { createCaptureSessionTemplate } from "./capture-session.js";
export { createUploadBatchTemplate } from "./upload-batch.js";
export { createRecordTemplate } from "./record.js";
export { createRecipeTemplate } from "./recipe.js";
export { createIntakeJobTemplate } from "./intake-job.js";
export { createQuestionFollowupJobTemplate } from "./question-followup-job.js";
export { createTelegramMessageTemplate } from "./telegram-message.js";
export { createChatThreadTemplate, createMessageEntry } from "./chat-thread.js";
export { createChatJobTemplate } from "./chat-job.js";
export { createTodoViewTemplate } from "./todo-view.js";
export { createGsheetTemplate } from "./gsheet.js";
export { createLandmarkTemplate, parseLandmarkFields } from "./landmark.js";
export type {
  LandmarkFields,
  LandmarkNavigationData,
  LandmarkDestinationData,
} from "./landmark.js";
export { createDocTemplate } from "./doc.js";
export { createGdocTemplate } from "./gdoc.js";
export { createGfolderTemplate } from "./gfolder.js";
export { createGlinkTemplate } from "./glink.js";

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
