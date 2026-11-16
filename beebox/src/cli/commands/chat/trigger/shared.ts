/** What the `bbx chat trigger` subcommands share: the session, `--config`, and error reporting. */

import { resolveChatSessionId } from "../../../../core/chat/session/id-file.js";
import { errorMessage } from "../../../../shared/error-guards.js";

/** A usage error: its `detail` is printed as one line, exit 1. */
export class TriggerUsageError extends Error {
  readonly detail: string;
  constructor({ detail }: { detail: string }) {
    super("bbx chat trigger was given something it cannot use");
    this.name = "TriggerUsageError";
    this.detail = detail;
  }
}

export async function requireSession(): Promise<string> {
  const sessionId = await resolveChatSessionId();
  if (sessionId === null) throw new TriggerUsageError({ detail: "no chat session: run inside a chat session (BBX_CHAT_SESSION_ID)" });
  return sessionId;
}

export function parseConfig(raw: string | undefined): unknown {
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new TriggerUsageError({ detail: `--config is not JSON: ${errorMessage(e)}` });
  }
}

export async function runCli(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`bbx chat trigger: ${e instanceof TriggerUsageError ? e.detail : errorMessage(e)}`);
    process.exitCode = 1;
  } finally {
    await (await import("esbuild")).stop();
  }
}
