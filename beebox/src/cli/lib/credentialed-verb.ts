/**
 * Where a credentialed `bbx` verb actually runs, and what it prints when it
 * will not run — for every connector family, not just Drive.
 *
 * One rule, stated so that a missing marker fails closed: a credentialed verb
 * runs in-process ONLY under `BBX_SPAWN_PROFILE=tooling`. Any other value — a
 * box agent's shell, a plain login shell, a spawn site that forgot the marker —
 * delegates to this box's own server, which holds the credential the agent
 * profile deliberately withholds. With no reachable server it refuses and names
 * the missing piece. Delegation is chosen by who is calling, never by what the
 * process happens to be able to read
 * (`docs/plans/agent-capability-delegation.md`).
 *
 * Every refusal names one of three parties who can fix it: the caller (bad
 * input), the boxholder (enable, authorize, grant), or the machine (the server
 * could not do the work). That attribution is the thing the 2026-09-14
 * incident's message lacked.
 *
 * Nothing here knows about Drive, Calendar, or Gmail. A family contributes two
 * things: what its in-process half does, and which of its own errors are the
 * caller's fault (`callerFault`).
 */

import type { Command } from "commander";
import { TRPCClientError } from "@trpc/client";
import type { TRPCClient } from "@trpc/client";
import { boxClient } from "./box-client.js";
import { spawnProfile } from "../../lib/spawn-profile.js";
import { errorMessage } from "../../lib/error-guards.js";
import { isRecord } from "../../lib/is-record.js";
import { err, ok, type Result } from "../../lib/result.js";
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
export interface VerbRefusal {
  kind: string;
  message: string;
  fix: FixParty;
}

/**
 * Whose the hint is — never WHAT to do about it. The "what" is the refusal's
 * own message, which is written by whichever gate refused (a policy switch
 * names the switch, an authorization names the flow), so this line cannot
 * disagree with it or go stale when a second family arrives.
 */
const FIX_HINT: Record<FixParty, string> = {
  caller: "the caller — adjust the command and run it again",
  boxholder: "the boxholder — the message above names what to enable or authorize",
  machine: "the machine — the box's server could not do the work; the message above says what it hit",
};

/**
 * A connector gate refused in-process: the box's policy has the service
 * switched off, or nothing here can authorize it. Both arms are the
 * boxholder's, in two different places, so they keep two codes.
 *
 * Thrown rather than returned because it crosses a verb's `local` callback,
 * which the dispatcher already catches — the same place a delegated failure
 * arrives.
 */
export class CredentialGapError extends Error {
  readonly gap: "not-enabled" | "auth-gap";

  constructor(problem: { kind: "not-enabled" | "auth-gap"; message: string }) {
    super(problem.message);
    this.name = "CredentialGapError";
    this.gap = problem.kind;
  }
}

/** Errors a family owns that are the caller's input, not the box's state. */
export type CallerFaultCheck = (error: unknown) => boolean;

/**
 * Run a credentialed verb where it belongs.
 *
 * `local` runs under the tooling profile only. Everything else goes through
 * `remote`, which gets a tRPC client authenticated as this box's agent.
 */
export async function dispatchCredentialed<T>(options: {
  local: () => Promise<T>;
  remote: (client: TRPCClient<AppRouter>) => Promise<T>;
  /** Which of this family's own throws are the caller's fault. */
  callerFault?: CallerFaultCheck;
}): Promise<Result<T, VerbRefusal>> {
  if (spawnProfile() === "tooling") {
    try {
      return ok(await options.local());
    } catch (error) {
      return err(refusalFor(error, options.callerFault));
    }
  }

  const client = boxClient();
  if (!client.ok) {
    return err({ kind: "BOX_UNREACHABLE", message: client.error.message, fix: "machine" });
  }
  try {
    return ok(await options.remote(client.value));
  } catch (error) {
    return err(refusalFor(error, options.callerFault));
  }
}

/**
 * Classify any failure — local throw or delegated tRPC error — for relay.
 *
 * Also used by `force-wakeup`, which is delegated in every profile and so has
 * only the tRPC half of this to classify; sharing it keeps one mapping from a
 * server code to the party who can act on it.
 */
export function refusalFor(error: unknown, callerFault?: CallerFaultCheck): VerbRefusal {
  if (error instanceof CredentialGapError) {
    return {
      kind: error.gap === "not-enabled" ? "FORBIDDEN" : "PRECONDITION_FAILED",
      message: error.message,
      fix: "boxholder",
    };
  }
  if (callerFault?.(error) === true) {
    return { kind: "BAD_REQUEST", message: errorMessage(error), fix: "caller" };
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
 * Print a credentialed verb's outcome and exit.
 *
 * Human output is whatever the verb already printed; `--json` prints exactly
 * one object — the procedure's return value, or `{kind, message, fix}` for a
 * refusal — so an agent never parses prose.
 */
export async function runCredentialedVerb<T>(options: {
  json: boolean | undefined;
  run: () => Promise<Result<T, VerbRefusal>>;
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
export function reportRefusal(refusal: VerbRefusal, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(refusal));
    return;
  }
  console.error(refusal.message);
  console.error(`Who can fix it: ${FIX_HINT[refusal.fix]}.`);
}
