/**
 * Health check router — verifies box permissions, API keys, and basic integrity.
 *
 * Used by the dashboard to surface warnings, and by deploy scripts to
 * verify a box is working after setup.
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { createClaudeCliService, type ClaudeCliService } from "../../../services/claude-cli.js";
import { router, publicProcedure, ownerProcedure } from "../trpc.js";
import { getMistralApiKey } from "../../../core/mistral-key.js";
import { resolveNav, NAV_CARD_PATH } from "../../../core/nav.js";
import { getDeepgramCredentials } from "../../../core/deepgram-key.js";
import { loadTranscriptionConfig } from "../../../core/transcription/index.js";
import { getBoxShape } from "../../../lib/box-shape.js";
import { isRecord } from "../../../lib/is-record.js";
import { createGitAnnexService } from "../../../services/git-annex.js";
import { runAnnexDoctor } from "../../../core/annex/doctor.js";
import { findStaleTmpCaptureCards, TMP_CAPTURE_STALE_MS } from "../../../core/capture/sweep.js";
import { engineHealthChecks } from "./health-engine.js";
import { googleAuthHealthChecks } from "./health-google.js";
import { getBoxTime } from "../../../lib/time.js";
import { getHealthSnapshot } from "./health-snapshot.js";
import { checkSchedulerHeartbeat } from "../../../core/schedule/health-box.js";
import { acceptCurrentBoxGrowth, boxGrowthHealthCheck } from "../../../core/box-growth/health.js";

export interface HealthCheck {
  name: string;
  ok: boolean;
  message: string;
  severity: "error" | "warning";
  action?: "accept-box-growth";
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
 * Check that a directory is writable by the current process.
 *
 * Uses `fs.access(..., W_OK)` — a POSIX permission probe that never
 * creates a file. An earlier version wrote and unlinked a `.health-check-*`
 * file, which leaked into watched directories when the unlink failed or
 * a file watcher grabbed the file first.
 */
async function isWritable(dirPath: string): Promise<boolean> {
  try {
    await fs.access(dirPath, fsConstants.W_OK);
    return true;
  } catch (_e) {
    // access(W_OK) throwing IS the answer: not writable (or missing). Return false.
    return false;
  }
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
 * The git-annex conditions `cb doctor annex` cannot repair.
 *
 * Only those two: the other five are fixed automatically on `cb serve` /
 * `cb init`, so surfacing them here would report problems that no longer
 * exist by the time anyone reads the output. Both are `error` severity so the
 * deploy runbooks gate on them — the right lever, since refusing to *serve*
 * would take a box offline for a degradation (missing binary, which already
 * fails loudly at every read and commit) or for a loss already sustained
 * (missing content).
 */
async function annexHealthChecks(args: { repoRoot: string; boxRoot: string }): Promise<HealthCheck[]> {
  const result = await runAnnexDoctor(createGitAnnexService(), {
    repoRoot: args.repoRoot,
    boxRoot: args.boxRoot,
    options: { check: true },
  });
  const out: HealthCheck[] = [];
  for (const id of ["binary", "content-present"]) {
    const check = result.checks.find((c) => c.id === id);
    // Absent when the run short-circuited on a missing binary, which the
    // "binary" check itself already reports.
    if (check === undefined) continue;
    out.push({
      name: `annex-${id}`,
      ok: check.status !== "failed",
      message: check.message,
      severity: "error",
    });
  }
  return out;
}

/**
 * Gemini key check — the key is optional: it powers audio questions
 * (ask-about-audio) and scan-import's opt-in Gemini backend
 * (`CB_SCAN_VISION=gemini`); scan-import defaults to the Claude backend,
 * which needs no extra key.
 */
function geminiKeyCheck(): HealthCheck {
  const geminiKey = process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"] || null;
  const geminiSelected = process.env["CB_SCAN_VISION"] === "gemini";
  const message =
    geminiKey !== null
      ? "Gemini API key configured"
      : geminiSelected
        ? "CB_SCAN_VISION=gemini but no Gemini API key — scan-import will fail. Set GEMINI_KEY in .env"
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
  const gitWritable = await isWritable(gitObjectsDir);
  checks.push({
    name: "git-writable",
    ok: gitWritable,
    message: gitWritable
      ? ".git/objects is writable"
      : ".git/objects is not writable — all commits will fail (run: chown -R callback:callback " + gitRoot + ")",
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
    const hasKey = !!process.env["THINKING_OPENAI_API_KEY"];
    checks.push({
      name: "openai-api-key",
      ok: hasKey,
      message: hasKey
        ? "OpenAI API key configured (gpt-realtime-whisper)"
        : "THINKING_OPENAI_API_KEY not set — OpenAI realtime transcription will not work.",
      severity: "warning",
    });
  }

  // OpenAI / Whisper key (needed for TTS, and Whisper transcription if selected)
  const openaiKey = process.env["THINKING_OPENAI_API_KEY"] ?? null;
  const openaiRequired = transcriptionConfig.service === "whisper";
  checks.push({
    name: "openai-api-key",
    ok: openaiKey !== null,
    message: openaiKey !== null
      ? "OpenAI API key configured (THINKING_OPENAI_API_KEY)"
      : openaiRequired
        ? "OpenAI API key not found — Whisper transcription and TTS will not work. Set THINKING_OPENAI_API_KEY in .env"
        : "OpenAI API key not found — TTS will not work. Set THINKING_OPENAI_API_KEY in .env",
    severity: "warning",
  });

  checks.push(geminiKeyCheck());

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
  acceptBoxGrowth: ownerProcedure.mutation(async ({ ctx }) => {
    await acceptCurrentBoxGrowth(ctx.boxRoot, { now: getBoxTime(ctx.boxRoot) });
    return { success: true as const };
  }),
});
