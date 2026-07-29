/**
 * Context assembly — build the complete context a box agent receives in a
 * given situation, layer by layer, so the whole stack can be reviewed as one
 * document (see `pnpm agent-context`, src/dev/agent-context.ts).
 *
 * Box-generated layers (CLAUDE.md files, skills, rules, the memory index) are
 * read from the box's disk — that is what the agent actually loads, so a stale
 * `cb init` shows up honestly here rather than being papered over; the layer
 * builders live in context-layers.ts. System prompts come from source.
 * Per-turn dynamic content (the `<chat-app>` snapshot, selections,
 * attachments) is inherently per-message and is noted, not rendered.
 *
 * The `boxRoot` option accepts either root of a v2 package box: it is
 * resolved to the OPERATIONAL root (`content/`) the agent actually runs in,
 * and the package root is derived from the box's shape.
 */

import {
  CHAT_SYSTEM_PROMPT,
  NARRATION_OVERLAY,
  buildLandmarkSessionNote,
} from "../../core/chat/session/prompts.js";
import { buildThreadSystemPrompt } from "../../core/chat/session/thread.js";
import {
  buildReactorSystemPrompt,
  buildReactorUserPrompt,
} from "../../core/reactor/prompts.js";
import { buildTimezoneContext } from "../../core/box/config.js";
import { findBoxRoot } from "../../lib/paths.js";
import { getBoxShape } from "../../lib/box-shape.js";
import {
  claudeMdLayer,
  memoryLayer,
  packageClaudeMdLayer,
  rulesInventoryLayer,
  schemaInstructionsLayer,
  skillBodyLayer,
  skillDescriptionsLayer,
  wordCount,
  type BoxRoots,
  type ContextLayer,
  type LayerLoading,
} from "./context-layers.js";

export { wordCount };
export type { ContextLayer, LayerLoading };

export interface AssembledContext {
  situation: string;
  description: string;
  /** The resolved OPERATIONAL box root (where agent sessions run). */
  boxRoot: string;
  layers: ContextLayer[];
  /** Dynamic content that exists in the situation but can't be rendered statically. */
  notRendered: string[];
}

export interface AssembleOptions {
  boxRoot: string;
  /** Inline this installed skill's body as an on-demand layer. */
  skill?: string | undefined;
  /** Include this card type's schema instructions (reactor: rides the job; chat: rules-loaded). */
  cardType?: string | undefined;
  /** Chat only: scope the session to this landmark directory. */
  landmarkDir?: string | undefined;
}

export const SITUATIONS: Record<string, string> = {
  chat: "The web-UI chat session (voice or typed), run in the box cwd.",
  "chat-thread": "A per-thread chat session (e.g. Telegram), one process per thread.",
  reactor: "A batch job-processing session spawned by the reactor during wakeup.",
};

export async function assembleContext(
  situation: string,
  options: AssembleOptions,
): Promise<AssembledContext> {
  const description = SITUATIONS[situation];
  if (description === undefined) {
    throw new UnknownSituationError(situation);
  }
  // Resolve to the OPERATIONAL root — for a v2 package box, `<pkg>/content/`
  // is what the agent actually runs in, and passing the package root would
  // silently measure the wrong (tiny, package-machinery) CLAUDE.md.
  const boxRoot = await findBoxRoot(options.boxRoot);
  if (boxRoot === null) {
    throw new NotABoxError(options.boxRoot);
  }
  const { packageRoot } = await getBoxShape(boxRoot);
  const roots: BoxRoots = { boxRoot, packageRoot };

  const layers: ContextLayer[] = [];
  const notRendered: string[] = [];

  layers.push(...(await systemPromptLayers(situation, { ...options, boxRoot })));
  const packageLayer = await packageClaudeMdLayer(roots);
  if (packageLayer !== null) layers.push(packageLayer);
  layers.push(await claudeMdLayer(boxRoot));
  const memory = await memoryLayer(roots);
  if (memory !== null) layers.push(memory);
  layers.push(await skillDescriptionsLayer(roots));
  layers.push(await rulesInventoryLayer(roots));

  if (options.skill !== undefined) {
    layers.push(await skillBodyLayer(roots, options.skill));
  }
  if (options.cardType !== undefined) {
    layers.push(await schemaInstructionsLayer(boxRoot, options.cardType));
  }

  if (situation === "chat" || situation === "chat-thread") {
    notRendered.push(
      "Per-message: the `<chat-app>` state snapshot, `<user-selection>` blocks, `<attachments>` blocks (see session-context.ts / chat-session-prompts.ts).",
    );
  }
  if (situation === "reactor") {
    notRendered.push(
      "Per-run: the actual job descriptions (job card content + inlined refs + schema instructions) interpolated into the user prompt.",
    );
  }
  if (options.landmarkDir !== undefined) {
    notRendered.push(
      `Landmark cwd: this chat runs with its working directory set to the landmark directory (\`${options.landmarkDir}\`), so any directory-local CLAUDE.md / MAP.md there (and in its ancestors up to the box root) also loads into context. Those are not rendered here — only the box-root CLAUDE.md above is.`,
    );
  }

  return { situation, description, boxRoot, layers, notRendered };
}

class NotABoxError extends Error {
  constructor(path: string) {
    super(`No box found at ${path} (no .cb-box marker at or below it)`);
    this.name = "NotABoxError";
  }
}

class UnknownSituationError extends Error {
  constructor(situation: string) {
    const known = Object.keys(SITUATIONS).join(", ");
    super(`Unknown situation "${situation}" (known: ${known})`);
    this.name = "UnknownSituationError";
  }
}

async function systemPromptLayers(
  situation: string,
  options: AssembleOptions,
): Promise<ContextLayer[]> {
  // The runtime appends the box timezone context to each situation's system
  // prompt (chat: buildBackendStartOptions; chat-thread: startRun; reactor:
  // runAgent). Empty string when no timezone is configured, so assembly is
  // unchanged in that case — matching the runtime.
  const tzContext = await buildTimezoneContext(options.boxRoot);
  if (situation === "chat") {
    // Composed exactly as start.ts does: prompt + tz + overlay, then the
    // landmark session note (when scoped to a landmark directory) appended last.
    let text = CHAT_SYSTEM_PROMPT + tzContext + NARRATION_OVERLAY;
    if (options.landmarkDir !== undefined) {
      text += buildLandmarkSessionNote(options.landmarkDir);
    }
    return [{
      name: "Chat system prompt",
      source: "src/core/chat/session/prompts.ts",
      loading: "always",
      text,
    }];
  }
  if (situation === "chat-thread") {
    // thread.ts appends the tz context after the thread system prompt.
    return [{
      name: "Chat-thread system prompt (placeholders unexpanded)",
      source: "src/core/chat/session/thread.ts",
      loading: "always",
      text: buildThreadSystemPrompt({
        threadRef: "${threadRef}",
        chatDescription: "${chatDescription}",
        sessionViewBaseUrl: "${sessionViewBaseUrl}",
      }) + tzContext,
    }];
  }
  // reactor — runAgent appends the tz context after the system prompt.
  return [
    {
      name: "Reactor system prompt",
      source: "src/core/reactor/prompts.ts",
      loading: "always",
      text: buildReactorSystemPrompt(options.boxRoot) + tzContext,
    },
    {
      name: "Reactor user prompt (template)",
      source: "src/core/reactor/prompts.ts",
      loading: "situational",
      text: buildReactorUserPrompt(["<job-path>"], { jobDescriptions: ["<job-description>"] }),
    },
  ];
}
