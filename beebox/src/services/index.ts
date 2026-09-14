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
import type { CodexCliService } from "./codex-cli.js";
import type { GoogleAuthService } from "./google-auth.js";
import type { GoogleCalendarService } from "./google-calendar.js";
import type { GoogleGmailService } from "./google-gmail.js";
import type { TtsService } from "./tts.js";
import type { EmbeddingsService } from "./openai-embeddings.js";
import type { GoogleDriveService } from "./google-drive.js";
import type { WakeupRunner } from "../core/commands/wakeup-runner.js";

// ─── Services container ──────────────────────────────────────────────────────

export interface Services {
  telegram?: TelegramService | undefined;
  claudeCli?: ClaudeCliService | undefined;
  codexCli?: CodexCliService | undefined;
  googleAuth?: GoogleAuthService | undefined;
  calendar?: GoogleCalendarService | undefined;
  gmail?: GoogleGmailService | undefined;
  openaiAudio?: TtsService | undefined;
  embeddings?: EmbeddingsService | undefined;
  drive?: GoogleDriveService | undefined;
  /**
   * How `wakeup.force` runs a wakeup. Production leaves it unset and the
   * procedure spawns the same supervised `bbx wakeup` child the Sync button
   * and the scheduler run; a test substitutes a runner rather than spawning a
   * real CLI.
   */
  wakeupRunner?: WakeupRunner | undefined;
}
