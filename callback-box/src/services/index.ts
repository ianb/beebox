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
import type { RaindropService } from "./raindrop.js";
import type { ImapService } from "./imap.js";
import type { OpenAIAudioService } from "./openai-audio.js";
import type { FeedFetcherService } from "./feed-fetcher.js";
import type { ArticleFetcherService } from "./article-fetcher.js";

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

export type { RaindropService, RaindropCollection, RaindropBookmark } from "./raindrop.js";
export {
  createRaindropService,
  createFakeRaindrop,
} from "./raindrop.js";

export type { ImapService, ImapMessage, ImapEnvelope } from "./imap.js";
export {
  createImapService,
  createFakeImap,
} from "./imap.js";

export type { OpenAIAudioService, TranscriptionResult, TTSResult } from "./openai-audio.js";
export {
  createOpenAIAudioService,
  createFakeOpenAIAudio,
} from "./openai-audio.js";

export type { FeedFetcherService, FeedResponse } from "./feed-fetcher.js";
export {
  createFeedFetcherService,
  createFakeFeedFetcher,
} from "./feed-fetcher.js";

export type { ArticleFetcherService, ArticleFetchResult } from "./article-fetcher.js";
export {
  createArticleFetcherService,
  createFakeArticleFetcher,
} from "./article-fetcher.js";

export type { CallEntry, WithCallLog } from "./call-log.js";
export { withCallLog, printCalls } from "./call-log.js";

// ─── Services container ──────────────────────────────────────────────────────

export interface Services {
  telegram?: TelegramService | undefined;
  claudeCli?: ClaudeCliService | undefined;
  googleAuth?: GoogleAuthService | undefined;
  calendar?: GoogleCalendarService | undefined;
  raindrop?: RaindropService | undefined;
  imap?: ImapService | undefined;
  openaiAudio?: OpenAIAudioService | undefined;
  feedFetcher?: FeedFetcherService | undefined;
  articleFetcher?: ArticleFetcherService | undefined;
}
