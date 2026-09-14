/**
 * Where a credentialed `bbx drive` verb actually runs, and what it prints when
 * it will not run.
 *
 * One rule, stated so that a missing marker fails closed: a credentialed verb
 * runs in-process ONLY under `BBX_SPAWN_PROFILE=tooling`. Any other value — a
 * box agent's shell, a plain login shell, a spawn site that forgot the marker —
 * delegates to this box's own server, which holds the Google credential the
 * agent profile deliberately withholds. With no reachable server it refuses and
 * names the missing piece. Delegation is chosen by who is calling, never by
 * what the process happens to be able to read
 * (`docs/plans/agent-capability-delegation.md`).
 *
 * Every refusal names one of three parties who can fix it: the caller (bad
 * input), the boxholder (enable, authorize, grant), or the machine (the server
 * could not do the work). That attribution is the thing the 2026-09-14
 * incident's message lacked.
 */

import type { Command } from "commander";
import { TRPCClientError } from "@trpc/client";
import type { TRPCClient } from "@trpc/client";
import { boxClient } from "../lib/box-client.js";
import { spawnProfile } from "../../lib/spawn-profile.js";
import { errorMessage } from "../../lib/error-guards.js";
import { isRecord } from "../../lib/is-record.js";
import { err, ok, type Result } from "../../lib/result.js";
import { DriveMountError } from "../../connectors/drive-mount-errors.js";
import { resolveDriveService, type DriveAccessProblem } from "../../connectors/drive-access.js";
import type { GoogleDriveService } from "../../services/google-drive.js";
import type { AppRouter } from "../../webapp/trpc/router.js";

/**
 * The `--json` flag, read off the command rather than off an action parameter.
 * Commander appends options after the positional arguments, and a two-argument
 * verb's action would then take three parameters — one over the house limit.
 */
export function jsonFlag(command: Command): boolean {
  const value: unknown = command.opts()["json"];
  return value === true;
}

/** Who can act on a refusal. */
export type FixParty = "caller" | "boxholder" | "machine";

/** A refusal shaped for relay: a code, a sentence, and whose move it is. */
export interface DriveRefusal {
  kind: string;
  message: string;
  fix: FixParty;
}

const FIX_HINT: Record<FixParty, string> = {
  caller: "the caller — adjust the command and run it again",
  boxholder: "the boxholder — enable Drive, or authorize Google, then it will work unchanged",
  machine: "the machine — the box's server could not do the work; the message above says what it hit",
};

/** In-process Drive service for the tooling profile; throws a typed refusal. */
class DriveAccessError extends Error {
  readonly problem: DriveAccessProblem;
  constructor(problem: DriveAccessProblem) {
    super(problem.message);
    this.name = "DriveAccessError";
    this.problem = problem;
  }
}

/**
 * The Drive service for an in-process run. Unlike the old
 * `requireDriveService`, it throws rather than calling `process.exit`, so the
 * dispatcher can render it as the same typed refusal a delegated call returns.
 */
export async function localDriveService(boxRoot: string): Promise<GoogleDriveService> {
  const resolved = await resolveDriveService(boxRoot);
  if (!resolved.ok) throw new DriveAccessError(resolved.error);
  return resolved.value;
}

/**
 * Run a credentialed Drive verb where it belongs.
 *
 * `local` runs under the tooling profile only. Everything else goes through
 * `remote`, which gets a tRPC client authenticated as this box's agent.
 */
export async function dispatchDrive<T>(options: {
  local: () => Promise<T>;
  remote: (client: TRPCClient<AppRouter>) => Promise<T>;
}): Promise<Result<T, DriveRefusal>> {
  if (spawnProfile() === "tooling") {
    try {
      return ok(await options.local());
    } catch (error) {
      return err(refusalFor(error));
    }
  }

  const client = boxClient();
  if (!client.ok) {
    return err({ kind: "BOX_UNREACHABLE", message: client.error.message, fix: "machine" });
  }
  try {
    return ok(await options.remote(client.value));
  } catch (error) {
    return err(refusalFor(error));
  }
}

/** The one refusal for `bbx drive sync` outside the tooling profile. */
export function syncWrongProfileRefusal(): DriveRefusal {
  return {
    kind: "WRONG_PROFILE",
    message:
      "`bbx drive sync` runs the Drive connector in this process, which needs the Google " +
      "credential this shell does not hold. Use `bbx force-wakeup --connector google-drive` " +
      "instead: the server runs the same cycle the schedule runs, and reports what it did.",
    fix: "caller",
  };
}

/**
 * Classify any failure — local throw or delegated tRPC error — for relay.
 *
 * Also used by `force-wakeup`, which is delegated in every profile and so has
 * only the tRPC half of this to classify; sharing it keeps one mapping from a
 * server code to the party who can act on it.
 */
export function refusalFor(error: unknown): DriveRefusal {
  if (error instanceof DriveAccessError) {
    return {
      kind: error.problem.kind === "not-enabled" ? "FORBIDDEN" : "PRECONDITION_FAILED",
      message: error.problem.message,
      fix: "boxholder",
    };
  }
  if (error instanceof DriveMountError) {
    return { kind: "BAD_REQUEST", message: error.message, fix: "caller" };
  }
  if (error instanceof TRPCClientError) {
    const code = trpcErrorCode(error);
    return { kind: code, message: error.message, fix: fixFor(code) };
  }
  return { kind: "INTERNAL_SERVER_ERROR", message: errorMessage(error), fix: "machine" };
}

/**
 * The server's own code for a delegated failure. `TRPCClientError.data` is
 * untyped by construction (it crossed the wire), so read it as the parse
 * boundary it is; a response without one is the machine's problem, not a
 * refusal we can attribute.
 */
function trpcErrorCode(error: TRPCClientError<AppRouter>): string {
  const data: unknown = error.data;
  if (isRecord(data) && typeof data["code"] === "string") return data["code"];
  return "INTERNAL_SERVER_ERROR";
}

/**
 * Three-party attribution. The two gates a box can be behind are the
 * boxholder's (a policy switch, an authorization); a rejected input is the
 * caller's; everything else is the machine's.
 */
function fixFor(code: string): FixParty {
  if (code === "FORBIDDEN" || code === "PRECONDITION_FAILED") return "boxholder";
  if (code === "BAD_REQUEST") return "caller";
  return "machine";
}

/**
 * Print a Drive verb's outcome and exit.
 *
 * Human output is whatever the verb already printed; `--json` prints exactly
 * one object — the procedure's return value, or `{kind, message, fix}` for a
 * refusal — so an agent never parses prose.
 */
export async function runDriveVerb<T>(options: {
  json: boolean | undefined;
  run: () => Promise<Result<T, DriveRefusal>>;
  print: (value: T) => void;
  /** A success that still warrants a non-zero exit (a mount whose children failed). */
  failed?: (value: T) => boolean;
}): Promise<void> {
  const result = await options.run();
  if (!result.ok) {
    reportRefusal(result.error, options.json === true);
    process.exit(1);
  }
  if (options.json === true) {
    console.log(JSON.stringify(result.value));
  } else {
    options.print(result.value);
  }
  if (options.failed?.(result.value) === true) process.exit(1);
}

/** Render a refusal for a person or for an agent. */
export function reportRefusal(refusal: DriveRefusal, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(refusal));
    return;
  }
  console.error(refusal.message);
  console.error(`Who can fix it: ${FIX_HINT[refusal.fix]}.`);
}
