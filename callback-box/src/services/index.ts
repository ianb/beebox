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

export type { CallEntry, WithCallLog } from "./call-log.js";
export { withCallLog, printCalls } from "./call-log.js";

// ─── Services container ──────────────────────────────────────────────────────

export interface Services {
  telegram?: TelegramService | undefined;
  claudeCli?: ClaudeCliService | undefined;
  // Future services:
  // calendar?: GoogleCalendarService;
  // raindrop?: RaindropService;
  // imap?: ImapService;
  // openaiAudio?: OpenAIAudioService;
  // dropboxRelay?: DropboxRelayService;
  // captureRelay?: CaptureRelayService;
  // googleAuth?: GoogleAuthService;
}
