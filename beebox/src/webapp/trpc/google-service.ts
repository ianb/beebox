/**
 * "Give me this box's Google service, or refuse the way every other procedure
 * refuses."
 *
 * The two gaps a box can be behind are the boxholder's, in two different
 * places, so they get two codes: FORBIDDEN for a policy switch the caller may
 * be told how to flip, PRECONDITION_FAILED for an authorization only a browser
 * flow can grant. The CLI's refusal mapper reads exactly these two codes back
 * off the wire (`cli/lib/credentialed-verb.ts`), which is why the translation
 * lives in one place rather than once per router.
 *
 * An injected service (`ctx.services`) short-circuits both gates: a test that
 * hands a procedure a fake has already decided the box may use it.
 */

import { TRPCError } from "@trpc/server";
import type { GoogleAccessProblem } from "../../connectors/google-access.js";
import type { Result } from "../../lib/result.js";

/** The refusal a gap becomes on the wire. */
export function googleAccessError(problem: GoogleAccessProblem): TRPCError {
  return new TRPCError({
    code: problem.kind === "not-enabled" ? "FORBIDDEN" : "PRECONDITION_FAILED",
    message: problem.message,
  });
}

/**
 * The injected service, else the resolved one, else the refusal. `resolve` is a
 * thunk so a box that injected a fake never touches the token store.
 */
export async function googleService<T>(options: {
  injected: T | undefined;
  resolve: () => Promise<Result<T, GoogleAccessProblem>>;
}): Promise<T> {
  if (options.injected !== undefined) return options.injected;
  const resolved = await options.resolve();
  if (resolved.ok) return resolved.value;
  throw googleAccessError(resolved.error);
}
