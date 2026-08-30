/** Cross-process-safe mutations of the authorization fields in config/box.json. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { withCardLock } from "../lib/card-lock.js";
import { errnoCode } from "../lib/error-guards.js";
import { withFileLock } from "../lib/file-lock.js";
import { stageAndCommitPaths } from "../lib/git.js";
import { isRecord } from "../lib/is-record.js";
import { clearBoxConfigCache } from "../core/box/config.js";
import { canonicalizeEmail } from "./local-users.js";

const LOCK_WAIT_MS = 5_000;
const CONFIG_RELATIVE_PATH = "config/box.json";

class BoxConfigWriteError extends Error {
  constructor(
    readonly configPath: string,
    options?: { cause: unknown },
  ) {
    super("Box configuration is unreadable; refusing to replace it.", options);
    this.name = "BoxConfigWriteError";
  }
}

export interface BoxConfigMutationResult {
  config: Record<string, unknown>;
  commitError: Error | null;
}

export function normalizeAllowedEmails(emails: readonly string[]): string[] {
  const canonical = emails
    .filter((email) => email.includes("@"))
    .map((email) => canonicalizeEmail(email))
    .filter(Boolean);
  return [...new Set(canonical)];
}

async function readConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(configPath, "utf-8"));
    if (!isRecord(parsed)) throw new BoxConfigWriteError(configPath);
    return parsed;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return {};
    if (error instanceof BoxConfigWriteError) throw error;
    throw new BoxConfigWriteError(configPath, { cause: error });
  }
}

async function mutateConfig(options: {
  boxRoot: string;
  message: string;
  mutate: (config: Record<string, unknown>) => void;
}): Promise<BoxConfigMutationResult> {
  const configPath = path.join(options.boxRoot, CONFIG_RELATIVE_PATH);
  // Git runs inside this critical section, so use the default long-lived lock
  // profile rather than the request-scoped 15-second stale window.
  const lockPath = path.join(options.boxRoot, ".beebox", "box-config-write.lock");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.mkdir(path.join(options.boxRoot, ".beebox"), { recursive: true });
  return withCardLock(configPath, () =>
    withFileLock(
      { lockPath, metadata: { purpose: "box-config-write", configPath }, waitMs: LOCK_WAIT_MS },
      async () => {
        const config = await readConfig(configPath);
        options.mutate(config);
        await writeFileAtomic(configPath, { content: `${JSON.stringify(config, null, 2)}\n` });
        clearBoxConfigCache(options.boxRoot);
        let commitError: Error | null = null;
        try {
          await stageAndCommitPaths(options.boxRoot, {
            paths: [CONFIG_RELATIVE_PATH],
            message: options.message,
          });
        } catch (error) {
          commitError = error instanceof Error ? error : new Error(String(error));
        }
        return { config, commitError };
      },
    ),
  );
}

export async function updateBoxConfigFields(options: {
  boxRoot: string;
  allowedEmails?: string[] | undefined;
  googleServices?: Partial<Record<"calendar" | "gmail" | "drive", boolean | undefined>> | undefined;
  agentEngine?: "claude" | "codex" | undefined;
  /** The box's pinned model; `null` clears the pin (no policy). */
  agentModel?: string | null | undefined;
  /** Which engines the box may offer. The default engine is always kept. */
  engines?: Partial<Record<"claude" | "codex", boolean | undefined>> | undefined;
}): Promise<BoxConfigMutationResult> {
  const changed = [
    ...(options.allowedEmails === undefined ? [] : ["allowedEmails"]),
    ...(options.googleServices === undefined ? [] : ["googleServices"]),
    ...(options.agentEngine === undefined ? [] : ["agentEngine"]),
    ...(options.agentModel === undefined ? [] : ["agentModel"]),
    ...(options.engines === undefined ? [] : ["engines"]),
  ];
  return mutateConfig({
    boxRoot: options.boxRoot,
    message: `Update box config: ${changed.join(", ")}`,
    mutate(config) {
      if (options.allowedEmails !== undefined) {
        config.allowedEmails = normalizeAllowedEmails(options.allowedEmails);
      }
      if (options.googleServices !== undefined) {
        config.googleServices = options.googleServices;
      }
      if (options.agentEngine !== undefined) {
        config.agentEngine = options.agentEngine;
      }
      if (options.engines !== undefined) {
        // The default engine stays enabled whatever the caller sent: a box
        // whose default engine is off cannot run, and the loader would
        // override it anyway — better not to persist the contradiction.
        const fallback = typeof config.agentEngine === "string" ? config.agentEngine : "claude";
        config.engines = { ...options.engines, [fallback]: true };
      }
      if (options.agentModel !== undefined) {
        // Clearing removes the key rather than storing null: "no policy" is the
        // absence of the field, which is what every reader already looks for.
        if (options.agentModel === null) delete config.agentModel;
        else config.agentModel = options.agentModel;
      }
    },
  });
}

export async function grantBoxAccess(options: {
  boxRoot: string;
  email: string;
}): Promise<BoxConfigMutationResult> {
  const email = canonicalizeEmail(options.email);
  return mutateConfig({
    boxRoot: options.boxRoot,
    message: `Grant box access to ${email}`,
    mutate(config) {
      const existing = Array.isArray(config.allowedEmails)
        ? config.allowedEmails.filter((value): value is string => typeof value === "string")
        : [];
      config.allowedEmails = normalizeAllowedEmails([...existing, email]);
    },
  });
}
