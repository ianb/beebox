/**
 * Health check router — verifies box permissions, API keys, and basic integrity.
 *
 * Used by the dashboard to surface warnings, and by deploy scripts to
 * verify a box is working after setup.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { router, publicProcedure } from "../trpc.js";
import { getMistralApiKey } from "../../../core/mistral-key.js";

export interface HealthCheck {
  name: string;
  ok: boolean;
  message: string;
  severity: "error" | "warning";
}

/**
 * Check that a directory is writable by the current process.
 */
async function isWritable(dirPath: string): Promise<boolean> {
  try {
    const testFile = path.join(dirPath, `.health-check-${Date.now()}`);
    await fs.writeFile(testFile, "");
    await fs.unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run all health checks for a box.
 */
export async function runHealthChecks(boxRoot: string): Promise<HealthCheck[]> {
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

  // .git/objects writable (git add/commit needs this)
  const gitObjectsDir = path.join(boxRoot, ".git/objects");
  const gitWritable = await isWritable(gitObjectsDir);
  checks.push({
    name: "git-writable",
    ok: gitWritable,
    message: gitWritable
      ? ".git/objects is writable"
      : ".git/objects is not writable — all commits will fail (run: chown -R callback:callback " + boxRoot + ")",
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

  // store/archive/ writable (intake processing archives here)
  const archiveDir = path.join(boxRoot, "store/archive");
  const archiveWritable = await isWritable(archiveDir);
  checks.push({
    name: "archive-writable",
    ok: archiveWritable,
    message: archiveWritable
      ? "store/archive/ is writable"
      : "store/archive/ is not writable — intake processing will fail",
    severity: "error",
  });

  // --- API key checks ---

  // Mistral key (needed for Voxtral realtime transcription)
  const mistralKey = await getMistralApiKey(boxRoot);
  checks.push({
    name: "mistral-api-key",
    ok: mistralKey !== null,
    message: mistralKey !== null
      ? "Mistral API key configured"
      : "Mistral API key not found — voice transcription (realtime) will not work. Add config/connectors/mistral.secret.json or set CALLBACK_MISTRAL_API_KEY",
    severity: "warning",
  });

  // OpenAI / Whisper key (needed for audio transcription of captures)
  const openaiKey = process.env["THINKING_OPENAI_API_KEY"] ?? null;
  checks.push({
    name: "openai-api-key",
    ok: openaiKey !== null,
    message: openaiKey !== null
      ? "OpenAI API key configured (THINKING_OPENAI_API_KEY)"
      : "OpenAI API key not found — capture audio transcription and TTS will not work. Set THINKING_OPENAI_API_KEY in .env",
    severity: "warning",
  });

  // Gemini key (needed for image description in capture processing)
  const geminiKey = process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"] || null;
  checks.push({
    name: "gemini-api-key",
    ok: geminiKey !== null,
    message: geminiKey !== null
      ? "Gemini API key configured"
      : "Gemini API key not found — capture image description will not work. Set GEMINI_KEY in .env",
    severity: "warning",
  });

  // Claude Code credentials (needed for agent operations — chat, reactor, procedures)
  // Claude Code stores credentials in ~/.claude/.credentials.json (Linux) or Keychain (macOS)
  const credsPath = path.join(os.homedir(), ".claude", ".credentials.json");
  let hasClaudeCredentials = false;
  try {
    const creds = await fs.readFile(credsPath, "utf-8");
    const parsed = JSON.parse(creds);
    hasClaudeCredentials = !!(parsed.claudeAiOauth && parsed.claudeAiOauth.accessToken);
  } catch {
    // Not found or invalid
  }
  checks.push({
    name: "claude-credentials",
    ok: hasClaudeCredentials,
    message: hasClaudeCredentials
      ? "Claude Code credentials configured"
      : "Claude Code credentials not found — agent operations (chat, reactor, procedures) will not work. Run 'claude auth login' or copy credentials to ~/.claude/.credentials.json",
    severity: "error",
  });

  return checks;
}

export const healthRouter = router({
  check: publicProcedure.query(async ({ ctx }) => {
    const checks = await runHealthChecks(ctx.boxRoot);
    const hasErrors = checks.some((c) => !c.ok && c.severity === "error");
    const hasWarnings = checks.some((c) => !c.ok && c.severity === "warning");
    const status = hasErrors ? "unhealthy" : hasWarnings ? "degraded" : "healthy";
    return { status, checks };
  }),
});
