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
import { createClaudeCliService, type ClaudeCliService } from "../../../services/claude-cli.js";
import { router, publicProcedure } from "../trpc.js";
import { getMistralApiKey } from "../../../core/mistral-key.js";
import { resolveNav, NAV_CARD_PATH } from "../../../core/nav.js";
import { getDeepgramCredentials } from "../../../core/deepgram-key.js";
import { getGeminiApiKey } from "../../../core/gemini-key.js";
import { getOpenAiThinkingKey } from "../../../core/openai-thinking-key.js";
import { loadTranscriptionConfig } from "../../../core/transcription/index.js";
import { getBoxShape } from "../../../lib/box-shape.js";
import { isRecord } from "../../../lib/is-record.js";
import { findStaleTmpCaptureCards, TMP_CAPTURE_STALE_MS } from "../../../core/capture/sweep.js";
import { engineHealthChecks } from "./health-engine.js";
import { googleAuthHealthChecks } from "./health-google.js";
import { getBoxTime } from "../../../lib/time.js";
import { getHealthSnapshot } from "./health-snapshot.js";
import { checkSchedulerHeartbeat } from "../../../core/schedule/health-box.js";
import { boxGrowthHealthCheck } from "../../../core/box-growth/health.js";
import { acknowledgeBoxGrowthProcedure, expectBoxGrowthRatesProcedure } from "./health-box-growth.js";
import { isWritable, writability } from "./health-writability.js";
import { legacySecretFilesCheck } from "./health-secrets.js";
import { pendingMigrationsCheck } from "./health-migrations.js";
import { annexHealthChecks } from "./health-annex.js";

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

// deploy-info.json sits at the callback-box repo root. From this file
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
    path.join(boxRoot, "box/inbox"),
    path.join(boxRoot, "config/connectors"),
    path.join(boxRoot, "store/archive"),
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
}

/**
 * Captures still sitting unfiled in `tmp-capture/`.
 *
 * Staged captures are deliberately gitignored so a pre-triage photo is not
 * annexed before an agent files it — it still gets renamed, re-encoded, and
 * EXIF-rotated, and annexing on arrival would mint immutable objects for
 * superseded versions. The cost is that a staged capture is in neither git nor
 * the annex, which is the one window where box content has no second record at
 * all. Fine for hours, bad for weeks — so make a long window visible.
 *
 * `warning`, not `error`: a triage backlog is a nudge, not a defect, and this
 * must never fail a deploy or take a box offline. It is also deliberately NOT
 * a `cb doctor annex` check — that one is configuration-only, and a condition
 * that varies with pending work has no configuration remedy.
 *
 * Reuses the abandonment sweep's existing traversal and threshold rather than
 * walking the tree again with a second notion of "unfiled".
 */
async function unfiledCapturesCheck(boxRoot: string): Promise<HealthCheck> {
  const days = Math.round(TMP_CAPTURE_STALE_MS / (24 * 60 * 60 * 1000));
  const stale = await findStaleTmpCaptureCards({
    boxRoot,
    now: getBoxTime(boxRoot).getTime(),
  });
  return {
    name: "unfiled-captures",
    ok: stale.length === 0,
    message:
      stale.length === 0
        ? "no captures unfiled past the staging window"
        : `${String(stale.length)} capture(s) unfiled for over ${String(days)} days ` +
          `(e.g. ${stale[0] ?? ""}). Their bytes are in neither git nor the annex — file them with cb mv.`,
    severity: "warning",
  };
}

/**
 * Gemini key check — the key is optional: it powers audio questions
 * (ask-about-audio) and scan-import's opt-in Gemini backend
 * (`CB_SCAN_VISION=gemini`); scan-import defaults to the Claude backend,
 * which needs no extra key.
 */
async function geminiKeyCheck(boxRoot: string): Promise<HealthCheck> {
  const geminiKey = await getGeminiApiKey(boxRoot);
  const geminiSelected = process.env["CB_SCAN_VISION"] === "gemini";
  const message =
    geminiKey !== null
      ? "Gemini API key configured"
      : geminiSelected
        ? 'CB_SCAN_VISION=gemini but no Gemini API key — scan-import will fail. Grant the "gemini" secret to this box, or set GEMINI_KEY'
        : "Gemini API key not found (optional) — audio questions will not work; scan-import uses the Claude backend by default";
  return {
    name: "gemini-api-key",
    ok: geminiKey !== null || !geminiSelected,
    message,
    severity: "warning",
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

  // box/inbox/ writable (capture finalize writes here)
  const inboxDir = path.join(boxRoot, "box/inbox");
  const inboxWritable = await isWritable(inboxDir);
  checks.push({
    name: "inbox-writable",
    ok: inboxWritable,
    message: inboxWritable
      ? "box/inbox/ is writable"
      : "box/inbox/ is not writable — captures and connector imports will fail",
    severity: "error",
  });

  // .git/objects writable (git add/commit needs this). For a legacy box the
  // git repo (and its .git) lives at boxRoot; for a v2 box the git repo is
  // the PACKAGE root one level up — content/ is a plain subdirectory with no
  // .git of its own (see "One git repository at the repo root" in
  // docs/implemented-plans/boxes-as-packages-v2.md).
  const { packageRoot: gitRoot } = await getBoxShape(boxRoot);
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

  // config/connectors/ writable (secrets are stored here)
  const connectorsDir = path.join(boxRoot, "config/connectors");
  const connectorsWritable = await isWritable(connectorsDir);
  checks.push({
    name: "connectors-writable",
    ok: connectorsWritable,
    message: connectorsWritable
      ? "config/connectors/ is writable"
      : "config/connectors/ is not writable",
    severity: "warning",
  });

  // store/archive/ writable (inbox processing archives here)
  const archiveDir = path.join(boxRoot, "store/archive");
  const archiveWritable = await isWritable(archiveDir);
  checks.push({
    name: "archive-writable",
    ok: archiveWritable,
    message: archiveWritable
      ? "store/archive/ is writable"
      : "store/archive/ is not writable — inbox processing will fail",
    severity: "error",
  });

  checks.push(...(await annexHealthChecks({ repoRoot: gitRoot, boxRoot })));
  checks.push(await pendingMigrationsCheck(boxRoot));
  checks.push(await unfiledCapturesCheck(boxRoot));
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

  // Transcription service (Voxtral / Deepgram / Whisper). Only require the
  // key for the configured service; the others are optional.
  const transcriptionConfig = await loadTranscriptionConfig(boxRoot);
  if (transcriptionConfig.service === "voxtral") {
    const mistralKey = await getMistralApiKey(boxRoot);
    checks.push({
      name: "mistral-api-key",
      ok: mistralKey !== null,
      message: mistralKey !== null
        ? "Mistral API key configured (Voxtral)"
        : "Mistral API key not found — voice transcription will not work. Add config/connectors/mistral.secret.json or set CALLBACK_MISTRAL_API_KEY",
      severity: "warning",
    });
  } else if (transcriptionConfig.service === "deepgram") {
    const deepgramCreds = await getDeepgramCredentials(boxRoot);
    checks.push({
      name: "deepgram-credentials",
      ok: deepgramCreds !== null,
      message: deepgramCreds !== null
        ? "Deepgram credentials configured"
        : "Deepgram credentials not found — voice transcription will not work. Add config/connectors/deepgram.secret.json (apiKey + projectId) or set CALLBACK_DEEPGRAM_API_KEY + CALLBACK_DEEPGRAM_PROJECT",
      severity: "warning",
    });
  } else if (transcriptionConfig.service === "openai-realtime") {
    const hasKey = (await getOpenAiThinkingKey(boxRoot)) !== null;
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
  const openaiKey = await getOpenAiThinkingKey(boxRoot);
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
  const claudeCli = options?.claudeCli ?? createClaudeCliService();
  const authStatus = await claudeCli.authStatus();
  const loggedIn = authStatus["loggedIn"] === true;
  checks.push({
    name: "claude-credentials",
    ok: loggedIn,
    message: loggedIn
      ? "Claude Code is logged in"
      : "Claude Code is not logged in — agent operations (chat, reactor, procedures) will not work. Run `claude auth login` on this machine",
    severity: "error",
  });

  checks.push(...(await googleAuthHealthChecks(boxRoot, { now: getBoxTime(boxRoot) })));

  checks.push(...(await engineHealthChecks(boxRoot)));

  return checks;
}

export const healthRouter = router({
  /**
   * Served from a stale-while-revalidate snapshot (`health-snapshot.ts`) so the
   * dashboard's batch never waits on the deep probes. `{ fresh: true }` forces a
   * live run — that's the contract deploy runbooks use through the diag-key
   * bypass (see docs/health-checks.md). `cb health` and `/api/health` call
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
