/**
 * The Drive family's half of the credentialed-verb rule.
 *
 * The rule itself — in-process only under `BBX_SPAWN_PROFILE=tooling`, else
 * this box's own server, else a refusal naming the missing piece — lives in
 * `cli/lib/credentialed-verb.ts` and is shared with every other connector
 * family. What is Drive's own is here: the in-process service, which of Drive's
 * errors are the caller's fault, and the one verb that cannot delegate.
 */

import type { TRPCClient } from "@trpc/client";
import {
  CredentialGapError,
  dispatchCredentialed,
  type VerbRefusal,
} from "../../lib/credentialed-verb.js";
import type { Result } from "../../../shared/result.js";
import { DriveMountError } from "../../../connectors/google-drive/mount-errors.js";
import {
  DocsApiUnavailableError,
  isBoxholderFixable,
} from "../../../connectors/google-drive/handlers/docs/api-failure.js";
import { resolveDriveService } from "../../../google/access.js";
import type { GoogleDriveService } from "../../../services/google-drive/core.js";
import type { AppRouter } from "../../../webapp/trpc/routers.js";

/**
 * The Drive service for an in-process run. Unlike the old
 * `requireDriveService`, it throws rather than calling `process.exit`, so the
 * dispatcher can render it as the same typed refusal a delegated call returns.
 */
export async function localDriveService(boxRoot: string): Promise<GoogleDriveService> {
  const resolved = await resolveDriveService(boxRoot);
  if (!resolved.ok) throw new CredentialGapError(resolved.error);
  return resolved.value;
}

/**
 * Run a Drive verb where it belongs. A `DriveMountError` — a bad URL, an
 * occupied directory, a path that climbs out of the box — is the caller's. A
 * Docs API refusal the boxholder can fix (API disabled, scope missing) is
 * theirs, as the server's PRECONDITION_FAILED says on the delegated path.
 */
export async function dispatchDrive<T>(options: {
  local: () => Promise<T>;
  remote: (client: TRPCClient<AppRouter>) => Promise<T>;
}): Promise<Result<T, VerbRefusal>> {
  return dispatchCredentialed({
    local: async () => {
      try {
        return await options.local();
      } catch (error) {
        if (error instanceof DocsApiUnavailableError && isBoxholderFixable(error)) {
          throw new CredentialGapError({ kind: "auth-gap", message: error.message });
        }
        throw error;
      }
    },
    remote: options.remote,
    callerFault: (error) => error instanceof DriveMountError,
  });
}

/** The one refusal for `bbx drive sync` outside the tooling profile. */
export function syncWrongProfileRefusal(): VerbRefusal {
  return {
    kind: "WRONG_PROFILE",
    message:
      "`bbx drive sync` runs the Drive connector in this process, which needs the Google " +
      "credential this shell does not hold. Use `bbx force-wakeup --connector google-drive` " +
      "instead: the server runs the same cycle the schedule runs, and reports what it did.",
    fix: "caller",
  };
}
