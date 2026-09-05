/**
 * Health check router — verifies box permissions, API keys, and basic integrity.
 *
 * Used by the dashboard to surface warnings, and by deploy scripts to
 * verify a box is working after setup.
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import {
  AUTH_PROBE_INCONCLUSIVE,
  createClaudeCliService,
  type ClaudeCliService,
} from "../../../services/claude-cli.js";
import { router, publicProcedure } from "../trpc.js";
import { getMistralApiKey } from "../../../core/mistral-key.js";
import { resolveNav, NAV_CARD_PATH } from "../../../core/nav.js";
import { getDeepgramCredentials } from "../../../core/deepgram-key.js";
import { getGeminiApiKey } from "../../../core/gemini-key.js";
import { getOpenAiThinkingKey } from "../../../core/openai-thinking-key.js";
import { loadTranscriptionConfig } from "../../../core/transcription/index.js";
import { getBoxShape } from "../../../lib/box-shape.js";
import { isRecord } from "../../../lib/is-record.js";
import { getBoxDir } from "../../../lib/paths.js";
import { engineHealthChecks } from "./health-engine.js";
import { googleAuthHealthChecks } from "./health-google.js";
import { getBoxTime } from "../../../lib/time.js";
import { getHealthSnapshot } from "./health-snapshot.js";
import { checkSchedulerHeartbeat, loadScheduleHealth, type BoxScheduleHealth } from "../../../core/schedule/health-box.js";
import { boxGrowthHealthCheck } from "../../../core/box-growth/health.js";
import { acknowledgeBoxGrowthProcedure, expectBoxGrowthRatesProcedure } from "./health-box-growth.js";
import { isWritable, writability } from "./health-writability.js";
import { legacySecretFilesCheck } from "./health-secrets.js";
import { pendingMigrationsCheck } from "./health-migrations.js";
import { annexHealthChecks } from "./health-annex.js";
import { unfiledCapturesCheck, stalledJobsCheck } from "./health-stale.js";
import { staleIndexLockCheck } from "./health-git-lock.js";
import { templateUpdatesCheck } from "./health-templates.js";
import { packageDocsCheck } from "./health-package-docs.js";

export interface HealthCheck {
  name: string;
  ok: boolean;
  message: string;
  severity: "error" | "warning";
  actions?: Array<"acknowledge-box-growth" | "expect-box-growth-rates">;
}

export interface CommitInfo {
  hash: string;
  subject: string;
}

export interface VersionInfo {
  /** Wall-clock time the deploy script wrote deploy-info.json. null if file is absent (e.g. local dev). */
  deployedAt: string | null;
  /** Per-repo short hashes recorded by the deploy script. Empty object when deploy-info.json is absent. */
  commits: Record<string, CommitInfo>;
  /** ISO timestamp of when this server process started. */
  processStartedAt: string;
  /** Process uptime in seconds. */
  uptimeSec: number;
}

// deploy-info.json sits at the beebox repo root. From this file
// (src/webapp/trpc/routers/health.ts) that's four levels up.
const DEPLOY_INFO_PATH = path.join(PACKAGE_ROOT, "deploy-info.json");

const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

export async function readVersionInfo(): Promise<VersionInfo> {
  let deployedAt: string | null = null;
  const commits: Record<string, CommitInfo> = {};
  try {
    const raw = await fs.readFile(DEPLOY_INFO_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) {
      const parsedDeployedAt = parsed["deployedAt"];
      if (typeof parsedDeployedAt === "string") deployedAt = parsedDeployedAt;
      const parsedCommits = parsed["commits"];
      if (isRecord(parsedCommits)) {
        for (const [key, value] of Object.entries(parsedCommits)) {
          if (isRecord(value) && typeof value["hash"] === "string" && typeof value["subject"] === "string") {
            commits[key] = { hash: value["hash"], subject: value["subject"] };
          }
        }
      }
    }
  } catch (_e) {
    // No deploy-info.json — likely local dev. Leave commits empty.
  }
  return {
    deployedAt,
    commits,
    processStartedAt: PROCESS_STARTED_AT,
    uptimeSec: Math.round(process.uptime()),
  };
}

/**
 * Sweep any leftover `.health-check-*` files from an earlier isWritable
 * implementation that wrote-then-unlinked. Silently ignores failures —
 * this is cleanup, not a hard requirement.
 */
async function sweepLegacyHealthCheckFiles(boxRoot: string): Promise<void> {
  const dirs = [
    getBoxDir(boxRoot, "inbox"),
    getBoxDir(boxRoot, "connectors"),
    // `_bookkeeping/archive` itself (the writability probe's target below,
    // not one of its done/failed/processed children).
    path.dirname(getBoxDir(boxRoot, "archiveDone")),
  ];
  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir);
      for (const name of entries) {
        if (name.startsWith(".health-check-")) {
          await fs.unlink(path.join(dir, name)).catch(() => {});
        }
      }
    } catch (_e) {
      // Directory missing or unreadable — nothing to sweep. Cleanup is best-effort.
    }
  }
}

export interface RunHealthChecksOptions {
  /**
   * Claude CLI service for the auth probe. Omit in production — a real
   * `createClaudeCliService()` is constructed. Tests inject a fake.
   */
  claudeCli?: ClaudeCliService | undefined;
  /**
   * Already-loaded schedule health, so the `template-updates` check can tell a
   * parked update apart from one that is blocking a failing task. `bbx health`
   * passes the evaluation it already did; when omitted the check loads it
   * itself, so the dashboard and `/api/health` escalate the same way.
   */
  scheduleHealth?: BoxScheduleHealth | undefined;
}


/**
 * Gemini key check — the key is optional: it powers audio questions
 * (ask-about-audio) and scan-import's opt-in Gemini backend
 * (`BBX_SCAN_VISION=gemini`); scan-import defaults to the Claude backend,
 * which needs no extra key.
 */
async function geminiKeyCheck(boxRoot: string): Promise<HealthCheck> {
  const geminiKey = await getGeminiApiKey(boxRoot, { purpose: "health-check", observe: false });
  const geminiSelected = process.env["BBX_SCAN_VISION"] === "gemini";
  const message =
    geminiKey !== null
      ? "Gemini API key configured"
      : geminiSelected
        ? 'BBX_SCAN_VISION=gemini but no Gemini API key — scan-import will fail. Grant the "gemini" secret to this box, or set GEMINI_KEY'
        : "Gemini API key not found (optional) — audio questions will not work; scan-import uses the Claude backend by default";
  return {
    name: "gemini-api-key",
    ok: geminiKey !== null || !geminiSelected,
    message,
    severity: "warning",
  };
}

/**
 * Claude Code auth, for agent operations (chat, reactor, procedures).
 *
 * Probes via `claude auth status` through the ClaudeCli service rather than
 * peeking at `~/.claude/.credentials.json`: that file only exists on Linux, so
 * the old file-peek skipped macOS entirely (where credentials live in the
 * Keychain), leaving local dev with no signal. The CLI reads whichever store
 * this platform uses.
 *
 * Three outcomes, not two. A probe that returns no usable answer is reported
 * as a warning that says so, never as "not logged in" — `claude auth status`
 * intermittently comes back empty on a machine that is genuinely logged in,
 * and naming the wrong remedy sends someone to re-authenticate for a problem
 * they do not have.
 */
async function claudeAuthCheck(injected?: ClaudeCliService): Promise<HealthCheck> {
  const claudeCli = injected ?? createClaudeCliService();
  const authStatus = await claudeCli.authStatus();
  if (authStatus["loggedIn"] === true) {
    return {
      name: "claude-credentials",
      ok: true,
      message: "Claude Code is logged in",
      severity: "error",
    };
  }
  if (authStatus[AUTH_PROBE_INCONCLUSIVE] === true) {
    return {
      name: "claude-credentials",
      ok: false,
      message:
        "Claude Code auth could not be determined — `claude auth status` returned no " +
        "usable answer. Agent operations may still work; re-run this check before acting on it",
      severity: "warning",
    };
  }
  return {
    name: "claude-credentials",
    ok: false,
    message:
      "The assistant engine (Claude Code) isn't signed in on this server — chat and " +
      "background processing (reactor, procedures) will not work. Run `claude auth login` on this machine",
    severity: "error",
  };
}

/**
 * Run all health checks for a box.
 */
export async function runHealthChecks(
  boxRoot: string,
  options?: RunHealthChecksOptions,
): Promise<HealthCheck[]> {
  await sweepLegacyHealthCheckFiles(boxRoot);
  const checks: HealthCheck[] = [];

  // --- Permission checks ---

  // _content/inbox/ writable (capture finalize writes here)
  const inboxDir = getBoxDir(boxRoot, "inbox");
  const inboxWritable = await isWritable(inboxDir);
  checks.push({
    name: "inbox-writable",
    ok: inboxWritable,
    message: inboxWritable
      ? "_content/inbox/ is writable"
      : "_content/inbox/ is not writable — captures and connector imports will fail",
    severity: "error",
  });

  // .git/objects writable (git add/commit needs this). Under the one-root
  // layout the git repo (and its .git) lives at boxRoot itself.
  const { boxRoot: gitRoot } = await getBoxShape(boxRoot);
  const gitObjectsDir = path.join(gitRoot, ".git/objects");
  const gitWritability = await writability(gitObjectsDir);
  const gitWritable = gitWritability === "writable";
  checks.push({
    name: "git-writable",
    ok: gitWritable,
    message:
      gitWritability === "writable"
        ? ".git/objects is writable"
        : gitWritability === "missing"
          ? ".git/objects is missing — commits will fail; verify the Git repository at " + gitRoot
          : ".git/objects is not writable in this process — commits will fail; " +
            "filesystem permissions or an execution sandbox may be preventing writes",
    severity: "error",
  });

  // _config/connectors/ writable (secrets are stored here)
  const connectorsDir = getBoxDir(boxRoot, "connectors");
  const connectorsWritable = await isWritable(connectorsDir);
  checks.push({
    name: "connectors-writable",
    ok: connectorsWritable,
    message: connectorsWritable
      ? "_config/connectors/ is writable"
      : "_config/connectors/ is not writable",
    severity: "warning",
  });

  // _bookkeeping/archive/ writable (inbox processing archives here)
  const archiveDir = path.dirname(getBoxDir(boxRoot, "archiveDone"));
  const archiveWritable = await isWritable(archiveDir);
  checks.push({
    name: "archive-writable",
    ok: archiveWritable,
    message: archiveWritable
      ? "_bookkeeping/archive/ is writable"
      : "_bookkeeping/archive/ is not writable — inbox processing will fail",
    severity: "error",
  });

  checks.push(...(await annexHealthChecks({ repoRoot: gitRoot, boxRoot })));
  checks.push(await staleIndexLockCheck(boxRoot));
  checks.push(await pendingMigrationsCheck(boxRoot));
  const scheduleHealth = options?.scheduleHealth ?? (await loadScheduleHealth(boxRoot, getBoxTime(boxRoot)));
  checks.push(await templateUpdatesCheck(boxRoot, scheduleHealth));
  checks.push(await packageDocsCheck(boxRoot));
  checks.push(await unfiledCapturesCheck(boxRoot));
  checks.push(await stalledJobsCheck(boxRoot));
  const now = getBoxTime(boxRoot);
  const scheduler = await checkSchedulerHeartbeat(boxRoot, now);
  checks.push(await boxGrowthHealthCheck(boxRoot, { now, schedulerStatus: scheduler.status }));

  // --- Interface card checks ---

  // nav.card, when present, must validate and point at real targets. An
  // absent card is fine (the menu has its builtin rows); a broken one just
  // renders no section, so this warning is the only place the breakage shows.
  const nav = await resolveNav(boxRoot);
  if (nav.status !== "absent") {
    const navProblem =
      nav.status === "invalid"
        ? `${NAV_CARD_PATH} is invalid (its menu section is not rendered): ${nav.error}`
        : nav.problems.length > 0
          ? `${NAV_CARD_PATH}: ${nav.problems.join("; ")}`
          : null;
    checks.push({
      name: "nav-card",
      ok: navProblem === null,
      message: navProblem ?? `${NAV_CARD_PATH} is valid`,
      severity: "warning",
    });
  }

  // --- API key checks ---
  //
  // Every key read below passes `observe: false` (`core/secrets/resolve.ts`):
  // these resolves answer "is this configured?" and never spend the key. The
  // access log still records them — a probe did read the value — but the
  // entry's `lastUsed`/`purposes` do not move, so a dashboard polling health
  // cannot make an unused grant look busy.

  // Transcription service (Voxtral / Deepgram / Whisper). Only require the
  // key for the configured service; the others are optional.
  const transcriptionConfig = await loadTranscriptionConfig(boxRoot);
  if (transcriptionConfig.service === "voxtral") {
    const mistralKey = await getMistralApiKey(boxRoot, { observe: false });
    checks.push({
      name: "mistral-api-key",
      ok: mistralKey !== null,
      message: mistralKey !== null
        ? "Mistral API key configured (Voxtral)"
        : "Mistral API key not found — voice transcription will not work. Add _config/connectors/mistral.secret.json or set BBX_MISTRAL_API_KEY",
      severity: "warning",
    });
  } else if (transcriptionConfig.service === "deepgram") {
    const deepgramCreds = await getDeepgramCredentials(boxRoot, { observe: false });
    checks.push({
      name: "deepgram-credentials",
      ok: deepgramCreds !== null,
      message: deepgramCreds !== null
        ? "Deepgram credentials configured"
        : "Deepgram credentials not found — voice transcription will not work. Add _config/connectors/deepgram.secret.json (apiKey + projectId) or set BBX_DEEPGRAM_API_KEY + BBX_DEEPGRAM_PROJECT",
      severity: "warning",
    });
  } else if (transcriptionConfig.service === "openai-realtime") {
    const hasKey = (await getOpenAiThinkingKey(boxRoot, { observe: false })) !== null;
    checks.push({
      name: "openai-api-key",
      ok: hasKey,
      message: hasKey
        ? "OpenAI API key configured (gpt-realtime-whisper)"
        : 'No OpenAI key — realtime transcription will not work. Grant the "openai-thinking" secret to this box, or set THINKING_OPENAI_API_KEY.',
      severity: "warning",
    });
  }

  // OpenAI / Whisper key (needed for TTS, and Whisper transcription if selected)
  const openaiKey = await getOpenAiThinkingKey(boxRoot, { observe: false });
  const openaiRequired = transcriptionConfig.service === "whisper";
  checks.push({
    name: "openai-api-key",
    ok: openaiKey !== null,
    message: openaiKey !== null
      ? 'OpenAI API key configured ("openai-thinking")'
      : openaiRequired
        ? 'OpenAI API key not found — Whisper transcription and TTS will not work. Grant the "openai-thinking" secret to this box, or set THINKING_OPENAI_API_KEY'
        : 'OpenAI API key not found — TTS will not work. Grant the "openai-thinking" secret to this box, or set THINKING_OPENAI_API_KEY',
    severity: "warning",
  });

  checks.push(await geminiKeyCheck(boxRoot));
  checks.push(await legacySecretFilesCheck(boxRoot));

  // Claude Code auth (needed for agent operations — chat, reactor, procedures).
  // Probe via `claude auth status` through the ClaudeCli service rather than
  // peeking at ~/.claude/.credentials.json: that file only exists on Linux, so
  // the old file-peek skipped macOS entirely (where credentials live in the
  // Keychain), leaving local dev with no signal. The CLI reads whichever store
  // this platform uses.
  checks.push(await claudeAuthCheck(options?.claudeCli));

  checks.push(...(await googleAuthHealthChecks(boxRoot, { now: getBoxTime(boxRoot) })));

  checks.push(...(await engineHealthChecks(boxRoot)));

  return checks;
}

export const healthRouter = router({
  /**
   * Served from a stale-while-revalidate snapshot (`health-snapshot.ts`) so the
   * dashboard's batch never waits on the deep probes. `{ fresh: true }` forces a
   * live run — that's the contract deploy runbooks use through the diag-key
   * bypass (see docs/health-checks.md). `bbx health` and `/api/health` call
   * `runHealthChecks` directly and are unaffected.
   */
  check: publicProcedure
    .input(z.object({ fresh: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return getHealthSnapshot(ctx.boxRoot, {
        fresh: input?.fresh === true,
        compute: async () => {
          const [checks, version] = await Promise.all([
            runHealthChecks(ctx.boxRoot, { claudeCli: ctx.services.claudeCli }),
            readVersionInfo(),
          ]);
          const hasErrors = checks.some((c) => !c.ok && c.severity === "error");
          const hasWarnings = checks.some((c) => !c.ok && c.severity === "warning");
          const status = hasErrors ? "unhealthy" : hasWarnings ? "degraded" : "healthy";
          return { status, checks, version };
        },
      });
    }),
  acknowledgeBoxGrowth: acknowledgeBoxGrowthProcedure,
  expectBoxGrowthRates: expectBoxGrowthRatesProcedure,
});
