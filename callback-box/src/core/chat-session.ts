/**
 * ChatSession — Manages a long-lived SDK chat run for interactive chat.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` via `ChatBackend` (in
 * `services/claude-chat.ts`). One backend run per spawned chat — the
 * session pushes user messages and receives SDK message events one turn
 * after another, and resumes sessions across restarts via the SDK's
 * `resume` option.
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { acquireChatActiveLock, releaseChatActiveLock } from "./schedule-state.js";
import {
  getDirectoryForSession,
  getFeaturesForSession,
  resolveSessionLogPath,
  updateFeaturesForSession,
} from "./chat-session-history.js";
import {
  composeChatAppSnapshot,
  isKnownFeature,
  isValidValue,
  parseChatAppDeltas,
  resolveFeatures,
  type FeatureMap,
} from "./chat-features.js";
import {
  parseSessionLog,
  tailForMinUserMessages,
  type SessionEntry,
} from "../cli/lib/session.js";
import { buildTimezoneContext } from "../webapp/box-config.js";
import { generateDocs } from "./generate-docs.js";
import { buildScriptEnv } from "./script-env.js";
import {
  createChatBackend,
  type ChatBackend,
  type ChatBackendRun,
  type ChatBackendStartOptions,
  type ChatContentBlock,
} from "../services/claude-chat.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Compute the tail size honoring both an explicit tail and a minimum number
 * of real user messages to include. Returns null to mean "no trimming".
 */
function effectiveTailSize(
  entries: SessionEntry[],
  params?: { tail?: number; minRealUserMessages?: number },
): number | null {
  const tail = params ? params.tail : undefined;
  const minUsers = params ? params.minRealUserMessages : undefined;
  const userTail = minUsers && minUsers > 0
    ? tailForMinUserMessages(entries, minUsers)
    : 0;
  if (tail !== undefined && tail > 0) {
    return Math.max(tail, userTail);
  }
  if (userTail > 0) return userTail;
  return null;
}

/**
 * Content block in a chat message, for the wire shape consumed by the
 * frontend over SSE.
 */
export interface ChatMessageContent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  /** For image blocks */
  source?: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

/**
 * A message emitted by ChatSession to consumers (chat routes, activity
 * pool). Stable wire shape for the frontend.
 */
export interface ChatMessage {
  type:
    | "system"
    | "assistant"
    | "user"
    | "stream_event"
    | "result"
    | "rate_limit_event";
  subtype?: string;
  session_id?: string;
  uuid?: string;
  message?: {
    role: string;
    content: ChatMessageContent[];
    stop_reason?: string | null;
  };
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  /** For `stream_event` messages — the raw `BetaRawMessageStreamEvent` payload. */
  event?: unknown;
  /** For `stream_event` — link to the parent assistant turn (or null). */
  parent_tool_use_id?: string | null;
}

/**
 * Map an SDKMessage to a ChatMessage (the stable wire shape).
 * Returns null for SDK message types we don't surface (partials, hooks,
 * status, etc.) — those stay internal to the SDK pipeline.
 */
function adaptSdkMessage(msg: SDKMessage): ChatMessage | null {
  switch (msg.type) {
    case "system": {
      // We only forward the init system message, the only one with session_id.
      if (msg.subtype !== "init") return null;
      return {
        type: "system",
        subtype: "init",
        session_id: msg.session_id,
      };
    }
    case "assistant": {
      const result: ChatMessage = {
        type: "assistant",
        session_id: msg.session_id,
        message: {
          role: msg.message.role,
          content: msg.message.content as ChatMessageContent[],
          ...(msg.message.stop_reason !== null && msg.message.stop_reason !== undefined
            ? { stop_reason: msg.message.stop_reason }
            : {}),
        },
      };
      if (msg.uuid) result.uuid = msg.uuid;
      return result;
    }
    case "user": {
      // SDK's SDKUserMessage carries content the assistant turn just consumed
      // (i.e., the user message we pushed in). Forward so the UI can echo it.
      const content = (msg.message as { content?: ChatMessageContent[] }).content;
      const out: ChatMessage = {
        type: "user",
        message: {
          role: "user",
          content: Array.isArray(content) ? content : [],
        },
      };
      if (msg.session_id !== undefined) out.session_id = msg.session_id;
      return out;
    }
    case "stream_event": {
      const out: ChatMessage = {
        type: "stream_event",
        session_id: msg.session_id,
        event: msg.event,
        parent_tool_use_id: msg.parent_tool_use_id,
      };
      if (msg.uuid) out.uuid = msg.uuid;
      return out;
    }
    case "result": {
      const r: ChatMessage = {
        type: "result",
        subtype: msg.subtype,
        session_id: msg.session_id,
        is_error: msg.is_error,
        duration_ms: msg.duration_ms,
        num_turns: msg.num_turns,
        total_cost_usd: msg.total_cost_usd,
      };
      if (msg.subtype === "success") r.result = msg.result;
      return r;
    }
    default:
      return null;
  }
}

const DEFAULT_SESSION_FILE = ".callback-box/chat-session-id.json";
const DEFAULT_MODEL_FILE = ".callback-box/chat-model.json";

/**
 * Configurable knobs for a ChatSession. All fields are optional — the
 * defaults match the pre-existing "main chat" behavior.
 */
export interface ChatSessionOptions {
  /** Resolves the system prompt at process-start. Default: CHAT_SYSTEM_PROMPT + tzContext. */
  systemPrompt?: (boxRoot: string) => Promise<string>;
  /**
   * Path to the current-session-id pointer, relative to boxRoot.
   * Default: .callback-box/chat-session-id.json. Set to `null` to opt out of
   * filesystem persistence — used by the registry, which manages session
   * bookkeeping out-of-band.
   */
  sessionFile?: string | null;
  /** Path to the current-model pointer, relative to boxRoot. Default: .callback-box/chat-model.json. */
  modelFile?: string;
  /** Extra env vars merged into the SDK subprocess env. */
  extraEnv?: Record<string, string>;
  /** Called once when the SDK assigns a new session ID. Used for per-session bookkeeping. */
  onSessionIdAssigned?: (sessionId: string) => Promise<void> | void;
  /**
   * Pre-set the session id (skips loading from `sessionFile`). Used by the
   * registry to construct an instance bound to a specific existing session.
   */
  initialSessionId?: string;
  /** Injectable backend — real by default; tests inject the fake. */
  backend?: ChatBackend;
  /**
   * Skip the `generateDocs` bootstrap step inside `startRun`. Useful in
   * tests where the box isn't a fully-initialized callback-box, and in
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

export const CHAT_SYSTEM_PROMPT = `You are in CALLBACK_BOX_CHAT_MODE.

You are a conversational assistant for this Callback Box — an agent-managed personal workspace where the filesystem is state and Git is history.

ABOUT THIS BOX:
- Data is stored as XML card files (\`Name.type.card\`) validated by schemas, in directories that reflect lifecycle stage
- \`box/inbox/\` — incoming items to triage
- \`box/jobs/\` — pending tasks for background agents to process
- \`box/questions/\` — pending questions for the user
- \`store/archive/\` — processed/completed items, organized by topic
- \`store/todos/\` — active todo lists
- \`config/\` — box configuration, guides, procedures, schedules
- Use \`cb\` commands for card operations: \`cb create\`, \`cb mv\`, \`cb validate\`, \`cb rm\`
- Git commits are the authoritative record of what happened — commit your work with meaningful messages

BEHAVIOR:
- Be concise and conversational — this is chat, not a report
- You can read and modify any files in this box
- For large tasks (multi-file changes, research, long operations): create a job card in \`box/jobs/\` using \`cb create\` so a background agent handles it. See \`docs/generated/agent-guide.md\` for job card format.
- For small tasks (quick lookups, single edits, answers): just do them directly
- In normal turn-by-turn chat, voice-in implies voice-out: if the user speaks (\`<speech>\` input), respond with \`<speech>\` so they can stay hands-free. If they type (\`<typed>\` input), speech is optional. (Narration mode overrides this — see the NARRATION MODE section if active.)
- When the user is speaking: before starting any task that takes more than a few seconds (file reads, tool calls, creating cards), send a brief \`<speech>\` message first explaining what you're about to do. The user sees tool activity but no text until you speak — silence while you work feels broken. Even "Let me look into that" is enough. Put the \`<speech>\` tag BEFORE any tool calls.

OUTPUT FORMAT:
Your response has two channels:
1. **Speech** — text inside \`<speech>\` tags is spoken aloud via TTS
2. **Display text** — everything outside \`<speech>\` tags is shown visually in the chat UI but NOT spoken

When the user is speaking, use speech as the primary response (1-3 sentences). Use display text to supplement with details too verbose to speak: lists, formatted data, links, tables. Display text supports Markdown. For simple conversational replies, speech alone is fine.

<example>
<speech>Here's a pasta carbonara recipe — pretty simple, about 30 minutes.</speech>

## Pasta Carbonara
- 200g spaghetti, 100g guanciale, 2 egg yolks + 1 whole egg, 50g pecorino, black pepper

1. Cook pasta in salted water
2. Crisp guanciale in a dry pan
3. Whisk eggs with cheese and pepper
4. Toss hot pasta with guanciale, then egg mixture off heat
</example>

SPEECH:
Wrap spoken text in \`<speech>\` tags. You can optionally add \`<instructions>\` inside the tag to adjust delivery — tone, pacing, emphasis. Only add instructions when the delivery matters; skip them for normal conversation.

<example>
<speech>I found three overdue items you might want to look at.
<instructions>Gentle, not urgent</instructions>
</speech>
</example>

Your default voice and base speaking style come from the personality card (\`<speaking-voice>\`) — \`docs/generated/card-personality.md\` lists available voices. For per-message overrides (alternate voices, replacing base instructions), see \`docs/generated/chat-voice.md\`.

INPUT FORMAT:
- User messages are wrapped in \`<speech>\` (voice) or \`<typed>\` (keyboard) tags
- The \`user\` attribute identifies the sender — multiple people may participate in the same chat
- **Voice input is transcribed** — spelling of names and technical terms may be wrong, and punctuation is added automatically by the transcription system. Interpret charitably; don't assume unusual spelling or punctuation is intentional.

IMAGES:
To display an image from the box filesystem: \`![description](/<box-root-path>)\` (e.g. \`![front view](/store/notes/photos/front.png)\`). When you're authoring inside a markdown file, you can also use a path relative to that file (e.g. \`![front view](photos/front.png)\` from a note in the same directory). The renderer rewrites both forms — don't include \`api/files/\` (it still works for back-compat, but the leading-slash form is preferred). The description is shown as a one-line caption under the image (truncated) and in full when the user clicks to zoom — so write it as a useful caption, not just a filename.

SHOWING FILES IN CHAT:
To show a file inline in the chat, use a view link: \`[label](view:<file-path>)\`
- \`[Meeting Notes](view:store/notes/meeting.md)\` — renders markdown inline
- \`[Recipe](view:store/archive/Pasta.recipe.card)\` — renders the card with its viewer
- The system picks the right viewer automatically based on file type
- Add \`?zoom\` to open as a companion panel alongside chat instead of inline:
  \`[Meeting Notes](view:store/notes/meeting.md?zoom)\`
  The companion panel stays visible while the user continues chatting. Use it for collaborative work.
- When a companion view is open, user messages include \`zoomed-view="view:..."\` so you know what they're looking at
- Views update live when the underlying file changes

For custom interactive dashboards, you can create \`.tsx\` view components — see \`docs/generated/views.md\` for the full API. Do NOT use \`view:\` links for custom views; those links are for file paths only.

SELF-NOTES:

User-position messages wrapped in \`<self-note>\` tags are records of background agent activity — usually a scheduled sub-agent run (daily rumination, weekly research, etc.). No one typed or spoke them; they are not user input. They exist so you're aware of what background work has happened and so the session transcript carries a trail of it.

The user is not present when a self-note arrives, and will not see an immediate reply. Any text you produce lands in the transcript as an asynchronous message for them to read when they next revisit chat — not a conversational response.

Given that:
- Default behavior is to produce nothing. A self-note is a record, not a request.
- Tool use can be appropriate (read a file, update state, create a follow-up job, set a schedule) when the note genuinely calls for it.
- Write text only if there's something worth surfacing when the user next looks at the chat — and write it as a message addressed to them later, not a reply in the moment.

Attributes: \`ref\` points to the script/procedure that produced the note; \`commit\` is the git commit with the full work. Use \`git show <commit>\` if you need details.

STATE SNAPSHOT (\`<chat-app>\`):
Each user message is prepended with a \`<chat-app .../>\` tag — a snapshot of chat features and the current wall-clock \`time\`. You don't need to act on it; skim and use as context.

Current features:
- \`narration\` — \`"on"\` shifts response expectations sharply (see NARRATION MODE below if active). Default \`"off"\`.
- \`prose\` — \`"on"\` shows your untagged prose in the UI; \`"off"\` hides it (only \`<ack>\` and \`<callout>\` render). Default \`"on"\`; narration toggles it off by convention.

To toggle a feature mid-conversation, emit \`<chat-app feature="value"/>\` in your response (e.g. \`<chat-app narration="on"/>\` or \`<chat-app prose="on"/>\`). The system applies the change after your turn and reflects it in the next message's snapshot. Don't try to set \`time\` — it's read-only.

ACKNOWLEDGEMENTS (\`<ack>\`):
For discrete actions you took, emit a compact \`<ack>\` indication instead of describing the action in prose. Each \`<ack>\` is rendered as an icon chip in chat — primary expression is the icon, optional inner text is a short modifier.

  \`<ack kind="appended" ref="recipes/Bread.recipe.card"/>\`
  \`<ack kind="edited" ref="docs/plan.md">Restructured the proofing section</ack>\`

The \`kind\` attribute is required and must be one of:
- \`created\` — a new file/card now exists
- \`appended\` — content was added to an existing file/card (semantic append; may target a section, may include light editing for flow)
- \`edited\` — existing content was changed (not just added to)
- \`todo-added\` — a new todo
- \`todo-completed\` — a todo marked complete
- \`no-response\` — you deliberately produced no reply (no prose, no callout, no action). Use this **instead of** writing "No response requested" or similar — it's the structured way to say "I heard you, nothing to do." No \`ref\` needed; no inner text needed.

If no kind fits an action-style ack, don't use \`<ack>\` — write prose or a \`<callout>\` instead. Use inner text **conservatively**: omit it when the action is the obvious thing the user asked for; include it only when you did something the user couldn't have predicted from their input. Don't emit \`<ack kind="no-response"/>\` and other acks together — the no-response tag means "I literally did nothing."

CALLOUTS (\`<callout>\`):
When part of your response is content the user must read — an answer to a real question, a proactive observation, an alert — wrap it in a \`<callout context="...">\` block. \`context\` is a short label that answers "why are you telling me this?" if the user encounters the callout cold (in a digest, notification, or feed preview). The body must stand alone — no "as you said" / "that thing" / "the one we discussed."

  \`<callout context="What's the weather Saturday?">Saturday: sunny, high of 72.</callout>\`
  \`<callout context="calendar conflict">Your dentist appointment overlaps with the soccer match — both at 10am Saturday.</callout>\`

\`<callout>\` and \`<speech>\` are siblings, never nested. To both show and speak the same content, emit both tags with the same body. Most turns have zero callouts — use them only when the user must see the content.

SCHEDULING:
To set a timer or reminder, include a \`<schedule>\` tag in your response text:
  \`<schedule in="20m" label="rice timer" alarm="1" announce="check rice timer">Tell the user to check the rice</schedule>\`

The tag attributes:
- \`in\` — duration until firing (e.g. "5m", "1h", "30s"). Precision is to the nearest minute.
- \`label\` — short name shown in UI and used for cancellation
- \`alarm="1"\` — play an alarm sound when it fires (omit for silent)
- \`announce="text"\` — text spoken aloud via TTS when it fires
- Tag content is context injected back to you when the schedule fires

When a schedule fires, you receive a \`<schedule-fired>\` message. To cancel: \`<cancel-schedule label="rice timer" />\`. Active schedules are listed in user messages.

Use schedules proactively, not just for explicit timer requests:
- Remind or follow up if the user doesn't respond after a while
- Check back on a topic you discussed ("How did that meeting go?")
- Encourage or nudge the user about something they mentioned wanting to do
- Monitor something over time (set a schedule, check, set another)
- Any situation where you'd want to "come back to this later"

COMMITS:
- If you make file changes, commit with a descriptive message.
- Do NOT add Co-Authored-By trailers — the system adds appropriate trailers automatically.`;

/**
 * Always appended to the chat system prompt. The full rules live in
 * docs/generated/narration-mode.md; the agent only consults that when
 * the per-turn <chat-app> snapshot reports narration="on", so the
 * always-included overhead is two sentences. Always-included so
 * mid-session toggles take effect without a subprocess restart.
 */
export const NARRATION_OVERLAY = `

NARRATION MODE: When the \`<chat-app>\` snapshot reports \`narration="on"\`, the user is dumping content (not chatting) and your turn defaults to silent — prefer \`<ack>\` for work done, \`<callout>\` for explicit questions, no \`<speech>\` unless asked or the user is hands-busy. See \`docs/generated/narration-mode.md\` for the full rules; consult it when narration is on.`;

/**
 * Note appended to the system prompt when this chat is bound to a
 * landmark directory. The CLAUDE.md / MAP.md inside that dir already load
 * automatically (they're under cwd) and may have been authored without
 * knowing they'd be read in a landmark context — this note tells the
 * agent the session itself is scoped to the directory.
 */
function buildLandmarkSessionNote(contextDir: string): string {
  return `\n\nLANDMARK SESSION:\nThis chat was started from the landmark for the directory \`${contextDir}\`. Treat the user's questions as scoped to that directory unless they say otherwise.`;
}

function log(context: string, ...args: unknown[]): void {
  console.log(`[ChatSession:${context}]`, ...args);
}

/**
 * An image attachment pasted/uploaded by the user, addressable by numeric id
 * via `[imageN]` tokens in the message text.
 */
export interface ChatImage {
  id: number;
  mimeType: string;
  /** Raw base64 data (no data: URL prefix) */
  dataBase64: string;
}

export interface ChatSendInput {
  text: string;
  images?: ChatImage[];
}

/**
 * Build the content array for a single compose (text + image attachments).
 *
 * `[imageN]` tokens in the text are replaced with the corresponding image
 * block. Attachments whose token is absent from the text are appended at
 * the end. Unknown tokens (id not in attachments) are left as literal text.
 */
export function buildContentBlocks(
  input: ChatSendInput
): ChatMessageContent[] {
  const { text, images } = input;
  const attached = images ?? [];
  if (attached.length === 0) {
    return [{ type: "text", text }];
  }

  const byId = new Map<number, ChatImage>();
  for (const img of attached) byId.set(img.id, img);
  const used = new Set<number>();

  const blocks: ChatMessageContent[] = [];
  const tokenRe = /\[image(\d+)]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    const idStr = match[1];
    if (!idStr) continue;
    const id = parseInt(idStr, 10);
    const img = byId.get(id);
    if (!img) continue; // leave orphan token as literal text in the next chunk
    if (match.index > cursor) {
      blocks.push({ type: "text", text: text.slice(cursor, match.index) });
    }
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mimeType,
        data: img.dataBase64,
      },
    } as ChatMessageContent);
    used.add(id);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    blocks.push({ type: "text", text: text.slice(cursor) });
  }

  // Append any unreferenced images at the end
  for (const img of attached) {
    if (used.has(img.id)) continue;
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mimeType,
        data: img.dataBase64,
      },
    } as ChatMessageContent);
  }

  // If only images were appended (no text at all), still include an empty
  // text marker so downstream filters can tell this was a user turn (not
  // PDF-plumbing). Shouldn't happen in practice since messages are wrapped
  // in <typed>/<speech> tags by the caller, but defensive.
  if (blocks.every((b) => b.type !== "text")) {
    blocks.unshift({ type: "text", text: "" });
  }

  return blocks;
}

/**
 * Convert a ChatMessageContent array into the SDK's ChatContentBlock array.
 * The shapes are compatible — we just narrow the type so downstream type
 * checks pass.
 */
function toBackendContent(blocks: ChatMessageContent[]): ChatContentBlock[] {
  const out: ChatContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      out.push({ type: "text", text: b.text ?? "" });
    } else if (b.type === "image" && b.source) {
      out.push({ type: "image", source: b.source });
    }
  }
  return out;
}

export class ChatSession extends EventEmitter {
  private run: ChatBackendRun | null = null;
  private sessionId: string | null = null;
  private boxRoot: string;
  private busy = false;
  /** Path of the chat-active lock held while a run is in flight, or null. */
  private chatLockPath: string | null = null;
  private turnText = "";
  private messageQueue: ChatSendInput[] = [];
  private readonly options: ChatSessionOptions;
  private readonly sessionFile: string | null;
  private readonly modelFile: string;
  private readonly backend: ChatBackend;
  private currentModel: string | null = null;
  /** Chat-feature flags resolved against the registry. Null = not loaded
   *  yet; first access triggers an async load from chat-session-history. */
  private currentFeatures: FeatureMap | null = null;
  private featuresLoadPromise: Promise<void> | null = null;
  /** Marker so the close listener can distinguish intentional shutdown
   *  (which clears the queue) from unexpected death (which drains it). */
  private intentionalStop = false;
  /**
   * Cached landmark binding. `undefined` = not resolved yet. `null` = resolved,
   * no binding. String = resolved binding. Set once on first `startRun` and
   * reused on drain/restart so we don't re-read history every turn.
   */
  private resolvedContextDir: string | null | undefined = undefined;

  constructor(boxRoot: string, options: ChatSessionOptions = {}) {
    super();
    this.boxRoot = boxRoot;
    this.options = options;
    this.sessionFile = options.sessionFile === undefined ? DEFAULT_SESSION_FILE : options.sessionFile;
    this.modelFile = options.modelFile ?? DEFAULT_MODEL_FILE;
    this.backend = options.backend ?? createChatBackend();
    if (options.initialSessionId !== undefined) {
      this.sessionId = options.initialSessionId;
    } else {
      this.sessionId = this.loadSessionId();
    }
    this.currentModel = this.loadCurrentModel();
    if (this.sessionId) {
      log("init", `Loaded session: ${this.sessionId}`);
    } else {
      log("init", "No saved session, will create on first message");
    }
    if (this.currentModel) {
      log("init", `Loaded model override: ${this.currentModel}`);
    }
  }

  private loadCurrentModel(): string | null {
    const filePath = path.join(this.boxRoot, this.modelFile);
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
          model: string | null;
        };
        return data.model ?? null;
      }
    } catch (e) {
      log("model", `Failed to load model file: ${e}`);
    }
    return null;
  }

  private saveCurrentModel(model: string | null): void {
    const filePath = path.join(this.boxRoot, this.modelFile);
    const dir = path.dirname(filePath);
    try {
      if (model === null) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return;
      }
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify({ model, savedAt: new Date().toISOString() })
      );
    } catch (e) {
      log("model", `Failed to save model file: ${e}`);
    }
  }

  private loadSessionId(): string | null {
    if (this.sessionFile === null) return null;
    const filePath = path.join(this.boxRoot, this.sessionFile);
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
          sessionId: string;
        };
        return data.sessionId;
      }
    } catch (e) {
      log("session", `Failed to load session file: ${e}`);
    }
    return null;
  }

  private saveSessionId(sessionId: string): void {
    if (this.sessionFile === null) return;
    const filePath = path.join(this.boxRoot, this.sessionFile);
    const dir = path.dirname(filePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          sessionId,
          savedAt: new Date().toISOString(),
        })
      );
      log("session", `Saved session ID: ${sessionId}`);
    } catch (e) {
      log("session", `Failed to save session file: ${e}`);
    }
  }

  /**
   * Resolve the system prompt for a new run. Uses the options override
   * if provided; otherwise falls back to the main-chat default
   * (CHAT_SYSTEM_PROMPT + tzContext + NARRATION_OVERLAY).
   *
   * NARRATION_OVERLAY is always included — its rules are gated in the
   * prose on what the agent reads in the per-turn <chat-app> snapshot,
   * so toggling narration mid-session works without a subprocess restart.
   */
  private async resolveSystemPrompt(): Promise<string> {
    if (this.options.systemPrompt !== undefined) {
      return this.options.systemPrompt(this.boxRoot);
    }
    const tzContext = await buildTimezoneContext(this.boxRoot);
    return CHAT_SYSTEM_PROMPT + tzContext + NARRATION_OVERLAY;
  }

  /**
   * Resolve the directory this chat is bound to, or null if none.
   * Explicit `options.contextDir` wins. Otherwise we only consult
   * `chat-session-history` when the session was constructed with a known
   * id (a resume) — for fresh-new sessions a binding can't predate the id
   * assignment, so there's nothing to look up and we skip the I/O. Cached
   * after first resolution so drain/restart paths don't repeat the read.
   */
  private async resolveContextDir(): Promise<string | null> {
    if (this.options.contextDir !== undefined) return this.options.contextDir;
    if (this.resolvedContextDir !== undefined) return this.resolvedContextDir;
    if (this.options.initialSessionId === undefined) {
      this.resolvedContextDir = null;
      return null;
    }
    try {
      this.resolvedContextDir = await getDirectoryForSession(
        this.boxRoot,
        this.options.initialSessionId,
      );
    } catch (e) {
      log("context-dir", `Lookup failed: ${e instanceof Error ? e.message : e}`);
      this.resolvedContextDir = null;
    }
    return this.resolvedContextDir;
  }

  /**
   * Compute the `ChatBackendStartOptions` this session would pass to
   * `backend.start()` for a fresh run (no resume id, no model override).
   * Exposed so the registry can pre-warm a backend with the same options
   * the next start() call would use.
   */
  async buildBackendStartOptions(): Promise<ChatBackendStartOptions> {
    const baseSystemPrompt = await this.resolveSystemPrompt();
    // Resolve the landmark binding sync when possible so the common
    // (non-landmark) startRun path doesn't add a microtask hop — tests
    // rely on a stable tick count between send/drain.
    let contextDir: string | null;
    if (this.options.contextDir !== undefined) {
      contextDir = this.options.contextDir;
    } else if (this.resolvedContextDir !== undefined) {
      contextDir = this.resolvedContextDir;
    } else if (this.options.initialSessionId === undefined) {
      this.resolvedContextDir = null;
      contextDir = null;
    } else {
      contextDir = await this.resolveContextDir();
    }
    const systemPrompt = contextDir
      ? baseSystemPrompt + buildLandmarkSessionNote(contextDir)
      : baseSystemPrompt;
    const cwd = contextDir ? path.join(this.boxRoot, contextDir) : this.boxRoot;
    const baseEnv = await buildScriptEnv(this.boxRoot, {
      CLAUDECODE: undefined,
    });
    const env: Record<string, string | undefined> = {
      ...baseEnv,
      ...(this.options.extraEnv ?? {}),
    };
    const startOpts: ChatBackendStartOptions = {
      cwd,
      systemPrompt,
      includePartialMessages: this.options.includePartialMessages === true,
      env,
    };
    if (contextDir) {
      startOpts.additionalDirectories = [this.boxRoot];
    }
    return startOpts;
  }

  /**
   * Start a new SDK chat run.
   */
  private async startRun(): Promise<void> {
    if (this.run !== null && !this.run.closed) {
      log("start", "Run already active");
      return;
    }

    // Ensure agent docs are up to date (fast mtime-cached no-op if nothing changed)
    if (this.options.skipBootstrap !== true) {
      await generateDocs(this.boxRoot);
    }

    log("start", "Starting SDK chat run");

    // Hold a chat-active lock for the duration of the SDK run so that
    // `cb tick` (and any other housekeeping process) can detect a chat is
    // mid-response and defer commits that would race with agent writes.
    await this.acquireRunLock();

    const startOpts = await this.buildBackendStartOptions();

    const run = this.backend.start({
      ...startOpts,
      resumeSessionId: this.sessionId ?? undefined,
      model: this.currentModel ?? undefined,
    });
    this.run = run;
    this.intentionalStop = false;

    // Background loop: pump SDK messages into handleMessage. Capture errors
    // and emit as "error" events.
    void this.consumeMessages(run);
  }

  private async acquireRunLock(): Promise<void> {
    if (this.chatLockPath !== null) return;
    try {
      const lockId = randomBytes(8).toString("hex");
      this.chatLockPath = await acquireChatActiveLock({
        boxRoot: this.boxRoot,
        lockId,
        sessionId: this.sessionId,
      });
    } catch (e) {
      log("error", `Failed to acquire chat-active lock: ${(e as Error).message}`);
      this.chatLockPath = null;
    }
  }

  private async releaseRunLock(): Promise<void> {
    if (this.chatLockPath === null) return;
    const lockPath = this.chatLockPath;
    this.chatLockPath = null;
    try {
      await releaseChatActiveLock(lockPath);
    } catch (e) {
      log("error", `Failed to release chat-active lock: ${(e as Error).message}`);
    }
  }

  private async consumeMessages(run: ChatBackendRun): Promise<void> {
    try {
      for await (const sdkMsg of run.messages) {
        const msg = adaptSdkMessage(sdkMsg);
        if (msg !== null) this.handleMessage(msg);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      log("error", `Run errored: ${err.message}`);
      this.emit("error", err);
    } finally {
      log("close", "Run ended");
      const wasIntentional = this.intentionalStop;
      this.run = null;
      this.busy = false;
      await this.releaseRunLock();
      this.emit("close", wasIntentional ? 0 : null);
      // Drain any messages queued while the run was busy into a fresh run,
      // unless this was an intentional stop (queue is already cleared).
      if (!wasIntentional && this.messageQueue.length > 0) {
        log("close", `Draining ${this.messageQueue.length} queued message(s) into fresh run`);
        this.drainQueue();
      }
    }
  }

  private handleMessage(msg: ChatMessage): void {
    // Capture session ID from first message
    if (msg.session_id && !this.sessionId) {
      this.sessionId = msg.session_id;
      log("session", `Got session ID: ${this.sessionId}`);
      this.saveSessionId(this.sessionId);
      if (this.options.onSessionIdAssigned !== undefined) {
        void Promise.resolve(this.options.onSessionIdAssigned(this.sessionId)).catch((e: unknown) => {
          log("session", `onSessionIdAssigned error: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    }

    // Accumulate assistant text for schedule parsing
    if (msg.type === "assistant" && msg.message) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text) {
          this.turnText += block.text;
        }
      }
    }

    this.emit("message", msg);

    if (msg.type === "result") {
      log("done", `Turn complete, is_error: ${msg.is_error}`);
      const completedText = this.turnText;
      this.turnText = "";
      this.busy = false;
      this.emit("done", msg);
      if (completedText) {
        this.emit("turn-text", completedText);
        // Apply any <chat-app> mutation tags the agent emitted in this turn.
        // Done after the busy flag flips so listeners reacting to features-changed
        // can call setFeature etc. without hitting the in-flight check.
        const { deltas } = parseChatAppDeltas(completedText);
        if (deltas.length > 0) {
          void this.applyFeatureDeltas(deltas).catch((e: unknown) => {
            log("features", `Failed to apply agent deltas: ${e instanceof Error ? e.message : e}`);
          });
        }
      }
      this.drainQueue();
    }
  }

  /**
   * Queue a message for delivery after the current turn completes.
   * Accepts either a plain string (back-compat) or a ChatSendInput with images.
   */
  enqueue(message: string | ChatSendInput): void {
    const input: ChatSendInput = typeof message === "string"
      ? { text: message }
      : message;
    log("enqueue", `Queued message (${input.text.length} chars, ${(input.images ?? []).length} image(s), queue size: ${this.messageQueue.length + 1})`);
    this.messageQueue.push(input);
  }

  /**
   * Send queued messages after a turn completes.
   * Combines the queued inputs into a single turn — text joined with
   * blank lines, image attachments concatenated (with per-message id
   * offsets to prevent `[imageN]` token collisions).
   */
  private drainQueue(): void {
    if (this.messageQueue.length === 0) return;
    const queued = this.messageQueue.splice(0);
    log("drain", `Sending ${queued.length} queued message(s)`);

    const combinedImages: ChatImage[] = [];
    const combinedTextParts: string[] = [];
    let idOffset = 0;
    for (const q of queued) {
      const imgs = q.images ?? [];
      let text = q.text;
      if (imgs.length > 0 && idOffset > 0) {
        // Renumber `[imageN]` tokens in this message's text and the image ids
        // to avoid collisions with previously-queued messages.
        text = text.replace(/\[image(\d+)]/g, (_m, n: string) => {
          const id = parseInt(n, 10);
          return `[image${id + idOffset}]`;
        });
        for (const img of imgs) {
          combinedImages.push({ ...img, id: img.id + idOffset });
        }
      } else {
        for (const img of imgs) combinedImages.push(img);
      }
      combinedTextParts.push(text);
      idOffset += imgs.length;
    }
    void this.send({ text: combinedTextParts.join("\n\n"), images: combinedImages });
  }

  /**
   * Send a message to claude. Starts a run if not running.
   * Returns false if a turn is already in progress.
   *
   * Accepts either a plain string (back-compat) or a ChatSendInput object
   * carrying the text plus any image attachments referenced by `[imageN]`
   * tokens in the text.
   */
  async send(message: string | ChatSendInput): Promise<boolean> {
    if (this.busy) {
      log("send", "Rejected — busy");
      return false;
    }

    if (this.run === null || this.run.closed) {
      await this.startRun();
    }

    if (this.run === null) {
      log("error", "Run not ready after start");
      return false;
    }

    this.busy = true;
    this.turnText = "";

    const rawInput: ChatSendInput = typeof message === "string"
      ? { text: message }
      : message;

    // Prepend the chat-app snapshot: feature flags + fresh wall-clock time.
    // Visible to the agent on every user turn; encapsulated to one tag so
    // it's easy for the agent to skim past when not relevant.
    await this.ensureFeaturesLoaded();
    const snapshot = composeChatAppSnapshot({
      features: this.currentFeatures ?? resolveFeatures(),
      time: new Date().toISOString(),
    });
    const input: ChatSendInput = {
      ...rawInput,
      text: `${snapshot}\n${rawInput.text}`,
    };

    const content = buildContentBlocks(input);
    const imgCount = (input.images ?? []).length;
    log("send", `Sending message (${input.text.length} chars, ${imgCount} image(s), ${content.length} block(s))`);
    this.run.send(toBackendContent(content));
    return true;
  }

  /**
   * Interrupt the current turn.
   */
  interrupt(): void {
    if (this.run === null || this.run.closed) {
      log("interrupt", "No run to interrupt");
      return;
    }
    log("interrupt", "Sending interrupt");
    void this.run.interrupt().catch((e: unknown) => {
      log("interrupt", `Interrupt failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  /**
   * Set the model for this chat session. Pass `null` to reset to the SDK default.
   * Persisted to the model file so subsequent runs pick it up. Does NOT
   * change the model of an in-flight run — caller must restart.
   */
  setModel(model: string | null): void {
    this.currentModel = model;
    this.saveCurrentModel(model);
  }

  getCurrentModel(): string | null {
    return this.currentModel;
  }

  /**
   * Lazy-load the persisted feature map from chat-session-history. Idempotent:
   * once loaded, the in-memory map is the source of truth and subsequent calls
   * are no-ops. Concurrent callers share the load promise.
   */
  private async ensureFeaturesLoaded(): Promise<void> {
    if (this.currentFeatures !== null) return;
    if (this.featuresLoadPromise !== null) {
      await this.featuresLoadPromise;
      return;
    }
    this.featuresLoadPromise = (async () => {
      let stored: Record<string, string> | null = null;
      if (this.sessionId !== null) {
        try {
          stored = await getFeaturesForSession(this.boxRoot, this.sessionId);
        } catch (e) {
          log("features", `Failed to load features: ${e instanceof Error ? e.message : e}`);
        }
      }
      this.currentFeatures = resolveFeatures(stored ?? undefined);
    })();
    await this.featuresLoadPromise;
  }

  /** Current feature map with defaults applied. Safe to call before features
   *  are loaded — returns pure defaults until the lazy load completes. */
  getFeatures(): FeatureMap {
    return resolveFeatures(this.currentFeatures ?? undefined);
  }

  /**
   * Set a single feature. Validates against the registry; throws for unknown
   * features or illegal values. Persists to session history if a session id
   * has been assigned. Emits `features-changed`.
   */
  async setFeature(name: string, value: string): Promise<void> {
    if (!isKnownFeature(name)) throw new Error(`Unknown feature: ${name}`);
    if (!isValidValue(name, value)) throw new Error(`Invalid value for ${name}: ${value}`);
    await this.ensureFeaturesLoaded();
    if (this.currentFeatures === null) this.currentFeatures = resolveFeatures();
    if (this.currentFeatures[name] === value) return; // no-op
    this.currentFeatures[name] = value;
    if (this.sessionId !== null) {
      await updateFeaturesForSession(this.boxRoot, {
        sessionId: this.sessionId,
        updates: { [name]: value },
      });
    }
    log("features", `setFeature ${name}=${value}`);
    this.emit("features-changed", { features: this.getFeatures() });
  }

  /**
   * Apply a batch of agent-emitted `<chat-app>` deltas. Same persistence and
   * event path as `setFeature`. Caller has already validated entries against
   * the registry (parseChatAppDeltas drops unknowns).
   */
  private async applyFeatureDeltas(
    deltas: Array<{ feature: string; value: string }>,
  ): Promise<void> {
    if (deltas.length === 0) return;
    await this.ensureFeaturesLoaded();
    if (this.currentFeatures === null) this.currentFeatures = resolveFeatures();
    const updates: Record<string, string> = {};
    for (const d of deltas) {
      if (this.currentFeatures[d.feature] === d.value) continue;
      this.currentFeatures[d.feature] = d.value;
      updates[d.feature] = d.value;
    }
    if (Object.keys(updates).length === 0) return;
    if (this.sessionId !== null) {
      await updateFeaturesForSession(this.boxRoot, {
        sessionId: this.sessionId,
        updates,
      });
    }
    log("features", `applied agent deltas: ${JSON.stringify(updates)}`);
    this.emit("features-changed", { features: this.getFeatures() });
  }

  /**
   * Load conversation history from the session log.
   */
  async getHistory(params?: { tail?: number; minRealUserMessages?: number }): Promise<{
    sessionId: string | null;
    entries: SessionEntry[];
    total: number;
  }> {
    if (!this.sessionId) {
      return { sessionId: null, entries: [], total: 0 };
    }

    const logPath = await resolveSessionLogPath(this.boxRoot, this.sessionId);
    if (!fs.existsSync(logPath)) {
      return { sessionId: this.sessionId, entries: [], total: 0 };
    }

    const result = await parseSessionLog({ logPath });
    const { entries, total } = result;
    const effectiveTail = effectiveTailSize(entries, params);
    if (effectiveTail !== null && effectiveTail < entries.length) {
      return {
        sessionId: this.sessionId,
        entries: entries.slice(entries.length - effectiveTail),
        total,
      };
    }
    return {
      sessionId: this.sessionId,
      entries,
      total,
    };
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isRunning(): boolean {
    return this.run !== null && !this.run.closed;
  }

  isBusy(): boolean {
    return this.busy;
  }

  /**
   * Stop the current run gracefully. Clears the pending queue so the
   * close handler won't auto-drain into a fresh run.
   */
  stop(): void {
    if (this.run !== null && !this.run.closed) {
      log("stop", "Stopping run");
      this.intentionalStop = true;
      this.messageQueue = [];
      void this.run.close();
    }
  }

  /**
   * Restart the current run. Closes the existing one (if any) but
   * preserves the session id and any queued messages — the close handler
   * drains the queue into the fresh run so wedged sessions recover
   * without losing in-flight user messages.
   */
  restart(): void {
    if (this.run === null || this.run.closed) {
      log("restart", "No run to restart");
      return;
    }
    log("restart", "Closing run — close handler will drain any queued messages");
    void this.run.close();
  }

  /**
   * Reset the session — stop the run and clear the saved session ID.
   * The next send() will start a fresh conversation.
   */
  resetSession(): void {
    log("reset", "Resetting session");
    this.stop();
    this.sessionId = null;
    if (this.sessionFile === null) return;
    const filePath = path.join(this.boxRoot, this.sessionFile);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log("reset", "Deleted session file");
      }
    } catch (e) {
      log("reset", `Failed to delete session file: ${e}`);
    }
  }
}
