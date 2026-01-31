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
} from "./registry.js";

// Re-export individual schema types
export type { Memo, MemoStatus } from "./memo.js";
export type { Question, QuestionStatus, QuestionInputType } from "./question.js";

// Re-export template functions
export { createMemoTemplate, createVoiceMemoTemplate } from "./memo.js";
export {
  createSelectQuestionTemplate,
  createTextQuestionTemplate,
  createConfirmQuestionTemplate,
} from "./question.js";
