/**
 * The field-test operator session (`docs/plans/agent-field-tests.md`, Track 3).
 *
 * One persistent conversation for a whole run — "a person is a single
 * identity" — built on the `ChatBackend` service (`src/services/claude-chat.ts`)
 * rather than `runAgent`, which is one-shot and box-rooted. Using the service
 * interface is what makes this wrapper testable: the fake backend gives a
 * scripted operator with no SDK, no subprocess and no cost.
 *
 * The harness drives it in two moves per checklist item: `sendActivity(brief)`
 * (the operator works, then says in its own words how it went) and
 * `runDebrief(questions)` (the questionnaire, asked only after the work, so the
 * questions cannot prime the behaviour they ask about).
 *
 * The per-activity limits and the message bookkeeping live in
 * `operator-turns.ts`; this module is the session's configuration and shape.
 */

import type { ChatBackend } from "../services/claude-chat.js";
import { trackOperatorTurns, type OperatorTurn } from "./operator-turns.js";
import { runQuestionnaire, type DebriefResult, type QuestionnaireQuestion } from "./questionnaire.js";

/** Turn cap per activity. Browse-driven work is turn-hungry (every snapshot,
 *  click and screenshot is a turn); the cap exists only so a truly stuck
 *  activity cannot eat the run, not to pressure the operator. */
const DEFAULT_MAX_TURNS = 100;
/** Awake-time budget per activity. */
const DEFAULT_ACTIVITY_TIMEOUT_MS = 20 * 60_000;
/** Awake time an interrupted activity gets to produce its own result. */
const DEFAULT_DRAIN_GRACE_MS = 2 * 60_000;
/** Tick period of the awake timeouts. */
const DEFAULT_TIMEOUT_POLL_MS = 5_000;

export interface OperatorConfig {
  backend: ChatBackend;
  /** The assembled four-layer prompt (`operator-prompt.ts`). */
  systemPrompt: string;
  /** Working directory — the RUN directory, never the box. */
  cwd: string;
  /** The scenario's `models.operator`. */
  model: string;
  /**
   * The built-in tools the operator has at all — the SDK's `tools` option,
   * which sets the available set, not `allowedTools`, which only pre-approves
   * permission prompts a `bypassPermissions` session never sees.
   *
   * This narrows the surface (no Edit/Write/WebFetch/Grep/Glob) but does NOT
   * enforce the "browser only" boundary by itself: `Bash` can run anything and
   * `Read` can read anything. Per the plan, that rule is instruction-level in
   * v1 — the boundaries prompt layer states it and the transcript makes a
   * violation visible — and tightens into a real permission policy if a run
   * shows the operator cheating.
   */
  tools: string[];
  /** Subprocess env (browse key, base URL). */
  env: Record<string, string | undefined>;
  /** Where the operator writes screenshots; debrief citations resolve here. */
  screenshotsDir: string;
  /** Per-activity turn cap. Defaults to 100. */
  maxTurnsPerActivity?: number | undefined;
  /** Per-activity awake-time budget. Defaults to 20 minutes. */
  activityTimeoutMs?: number | undefined;
  /** Grace for a cut-short activity to produce its result. Defaults to 2 min. */
  drainGraceMs?: number | undefined;
  /** Awake-timeout tick period; tests pass something small. */
  timeoutPollMs?: number | undefined;
}

export interface OperatorSession {
  /** Send one checklist item and wait for the operator to finish it. */
  sendActivity(brief: string): Promise<OperatorTurn>;
  /** Ask the questionnaire and collect the answers. */
  runDebrief(questions: readonly QuestionnaireQuestion[]): Promise<DebriefResult>;
  /** End the conversation. Idempotent. */
  stop(): Promise<void>;
  /** The SDK session id, once the backend has reported one. */
  sessionId(): string | null;
}

/**
 * Open the run's operator session. One `ChatBackendRun` is started here and
 * lives until `stop()`: every activity and every debrief question in the run is
 * a turn on this one conversation.
 */
export function startOperatorSession(config: OperatorConfig): OperatorSession {
  const tracker = trackOperatorTurns({
    run: config.backend.start({
      cwd: config.cwd,
      systemPrompt: config.systemPrompt,
      model: config.model,
      tools: config.tools,
      env: config.env,
    }),
    maxTurns: config.maxTurnsPerActivity ?? DEFAULT_MAX_TURNS,
    activityTimeoutMs: config.activityTimeoutMs ?? DEFAULT_ACTIVITY_TIMEOUT_MS,
    drainGraceMs: config.drainGraceMs ?? DEFAULT_DRAIN_GRACE_MS,
    pollMs: config.timeoutPollMs ?? DEFAULT_TIMEOUT_POLL_MS,
  });

  return {
    sendActivity: (brief: string) => tracker.send(brief),
    async runDebrief(questions: readonly QuestionnaireQuestion[]): Promise<DebriefResult> {
      return runQuestionnaire({
        questions,
        screenshotsDir: config.screenshotsDir,
        ask: async (question) => (await tracker.send(question)).note,
      });
    },
    stop: () => tracker.close(),
    sessionId: () => tracker.sessionId(),
  };
}
