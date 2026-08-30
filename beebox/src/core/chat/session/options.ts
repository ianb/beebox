/**
 * Constructor options for ChatSession.
 *
 * Extracted to its own leaf module so both `chat-session.ts` and the
 * start-options helpers in `chat-session-start.ts` can reference the type
 * without a value-level import cycle. `chat-session.ts` re-exports it so
 * existing importers are unaffected.
 */

import type { AgentEngine } from "../../box/config.js";
import type { ChatBackend } from "../../../services/claude-chat.js";

/**
 * Configurable knobs for a ChatSession. All fields are optional — the
 * defaults match the pre-existing "main chat" behavior.
 */
export interface ChatSessionOptions {
  /** Resolves the system prompt at process-start. Default: CHAT_SYSTEM_PROMPT + tzContext. */
  systemPrompt?: (boxRoot: string) => Promise<string>;
  /**
   * Path to the current-session-id pointer, relative to boxRoot.
   * Default: .beebox/chat-session-id.json. Set to `null` to opt out of
   * filesystem persistence — used by the registry, which manages session
   * bookkeeping out-of-band.
   */
  sessionFile?: string | null;
  /** Path to the current-model pointer, relative to boxRoot. Default: .beebox/chat-model.json. */
  modelFile?: string | null;
  /**
   * The engine this chat was created with, for the window before it has an id
   * to record one against. Ignored once the chat has a history entry — an
   * engine is fixed when a chat starts and never changes after.
   */
  engine?: AgentEngine | undefined;
  /** Select the model file once a native harness assigns a fresh session id. */
  modelFileForSession?: (sessionId: string) => string;
  /** Extra env vars merged into the SDK subprocess env. */
  extraEnv?: Record<string, string>;
  /** Called once when the SDK assigns a new session ID. Used for per-session bookkeeping. */
  onSessionIdAssigned?: (sessionId: string) => Promise<void> | void;
  /**
   * Initial chat-feature flags for this session (e.g. `{ narration: "on" }`).
   * Used by landmark seeding: when a chat is opened from a landmark that
   * declares feature defaults, those defaults seed the session. The values
   * land in the in-memory feature map immediately so the first user message's
   * snapshot reflects them, and they persist to history once the session id
   * is assigned. User toggles afterward override the seed.
   */
  seedFeatures?: Record<string, string>;
  /**
   * Pre-set the session id (skips loading from `sessionFile`). Used by the
   * registry to construct an instance bound to a specific existing session.
   */
  initialSessionId?: string;
  /**
   * This session's id was *coined* — reserved before the conversation existed
   * (`reserve.ts`) rather than assigned by the harness. Its first run starts a
   * fresh conversation under that id instead of resuming one; once a transcript
   * exists, later runs resume normally like any other session.
   */
  coinedSessionId?: string;
  /**
   * Called when a coined session starts its first run. A coined session never
   * fires `onSessionIdAssigned` — `captureAssignedSessionId` returns early when
   * the session already knows its id — so this is where the bookkeeping that
   * assignment used to trigger (history entry, feature seeds, most-active
   * pointer, husk card) happens instead. Fired at first run rather than at
   * reserve so an abandoned new chat leaves nothing behind.
   */
  onFirstRunStart?: (sessionId: string) => Promise<void> | void;
  /** Injectable backend — real by default; tests inject the fake. */
  backend?: ChatBackend;
  /**
   * Skip the `generateDocs` bootstrap step inside `startRun`. Useful in
   * tests where the box isn't a fully-initialized beebox, and in
   * activity sessions where the host box's docs aren't relevant to the
   * mode. Defaults to false (main chat behavior).
   */
  skipBootstrap?: boolean;
  /**
   * If true, forward `stream_event` partial-assistant messages from the
   * SDK out through the `message` event. Off by default — turn on when
   * the consumer (e.g. an SSE route to a streaming UI) wants delta-level
   * updates instead of one event per assistant block.
   */
  includePartialMessages?: boolean;
  /**
   * Box-relative directory this chat is bound to (set when the chat was
   * started from a landmark). When present, the SDK's `cwd` is the landmark
   * directory so its `CLAUDE.md` / `MAP.md` auto-load, the box root is added
   * via `additionalDirectories` so the rest of the box stays accessible, and
   * a one-line note is appended to the system prompt naming the directory.
   *
   * For fresh "new" sessions the registry passes this in directly. For
   * resumed sessions it's left undefined and ChatSession looks it up from
   * `chat-session-history` using the session id.
   */
  contextDir?: string;
}
