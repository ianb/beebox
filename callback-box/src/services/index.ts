/**
 * Services container — groups all external service dependencies.
 *
 * Passed through to routes and connectors. In production, services are created
 * from box config at server startup. In tests, fakes are substituted.
 *
 * All fields are optional — not every box configures every service.
 */

import type { TelegramService } from "./telegram.js";
import type { ClaudeCliService } from "./claude-cli.js";
import type { GoogleAuthService } from "./google-auth.js";
import type { GoogleCalendarService } from "./google-calendar.js";
import type { GoogleGmailService } from "./google-gmail.js";
import type { OpenAIAudioService } from "./openai-audio.js";
import type { GoogleDriveService } from "./google-drive.js";

// ─── Re-exports ─────────────────────────────────────────────────────────────

export type { TelegramService } from "./telegram.js";
export {
  createTelegramService,
  createFakeTelegram,
} from "./telegram.js";

export type { ClaudeCliService } from "./claude-cli.js";
export {
  createClaudeCliService,
  createFakeClaudeCli,
} from "./claude-cli.js";

export type { GoogleAuthService } from "./google-auth.js";
export {
  createGoogleAuthService,
  createFakeGoogleAuth,
} from "./google-auth.js";

export type { GoogleCalendarService, CalendarListEntry, CalendarEvent, EventsListResult } from "./google-calendar.js";
export {
  createGoogleCalendarService,
  createFakeGoogleCalendar,
} from "./google-calendar.js";

export type {
  GoogleGmailService,
  GmailMessage,
  GmailMessageRef,
  GmailHeader,
  GmailBody,
  GmailPayload,
  GmailAttachmentData,
  GmailLabel,
  ListMessagesResult,
  FakeGoogleGmailService,
} from "./google-gmail.js";
export {
  createGoogleGmailService,
  createFakeGoogleGmail,
} from "./google-gmail.js";

export type { OpenAIAudioService, TranscriptionResult, TTSResult } from "./openai-audio.js";
export {
  createOpenAIAudioService,
  createFakeOpenAIAudio,
} from "./openai-audio.js";

export type { GoogleDriveService, DriveFile, SpreadsheetMetadata, SheetProperties, FakeGoogleDriveService } from "./google-drive.js";
export {
  createGoogleDriveService,
  createFakeGoogleDrive,
} from "./google-drive.js";

export type { CallEntry, WithCallLog } from "./call-log.js";
export { withCallLog, printCalls } from "./call-log.js";

// ─── Services container ──────────────────────────────────────────────────────

export interface Services {
  telegram?: TelegramService | undefined;
  claudeCli?: ClaudeCliService | undefined;
  googleAuth?: GoogleAuthService | undefined;
  calendar?: GoogleCalendarService | undefined;
  gmail?: GoogleGmailService | undefined;
  openaiAudio?: OpenAIAudioService | undefined;
  drive?: GoogleDriveService | undefined;
}
