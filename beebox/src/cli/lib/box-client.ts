/**
 * "Call my own box's procedure with the agent bearer" — the client half of the
 * delegation pattern (`docs/plans/agent-capability-delegation.md`).
 *
 * A box agent's shell deliberately holds no connector credential, but it does
 * hold `BBX_AGENT_TOKEN`, which the per-box auth wall accepts as box-scoped
 * auth (`webapp/server-box-scope.ts`). So the credentialed half of a `bbx`
 * verb runs where the credential already lives — the box's server — and the
 * agent reads back the same typed result the settings page gets.
 *
 * This is `bbx chat self-note`'s shape (`cli/commands/chat.ts`) lifted onto
 * tRPC: same env vars, same bearer, same box. The three env vars come from
 * `core/script-env.ts`, so a shell that has none of them was not spawned by a
 * box — the refusal names which one is missing rather than failing later at
 * the socket.
 *
 * `AppRouter` is imported as a TYPE only; nothing of the server is bundled
 * into the CLI by this module.
 */

import { createTRPCClient, httpLink, type TRPCClient } from "@trpc/client";
import { err, ok, type Result } from "../../lib/result.js";
import type { AppRouter } from "../../webapp/trpc/router.js";

/** The env vars `core/script-env.ts` hands every box-spawned subprocess. */
const REQUIRED_VARS = ["BBX_SERVER_URL", "BBX_BOX_NAME", "BBX_AGENT_TOKEN"] as const;

/**
 * Why there is no client. `missing` names the one env var that was absent, so
 * a relayed message points at a spawn site rather than at Drive.
 */
export interface BoxClientUnavailable {
  kind: "box-client-unavailable";
  missing: (typeof REQUIRED_VARS)[number];
  message: string;
}

/**
 * A tRPC client for this box's own server, authenticated as the box's agent,
 * or the reason one cannot be built.
 *
 * Deliberately no fallback: a client that guessed at `localhost:3210` would
 * reach whichever box answered there.
 */
export function boxClient(): Result<TRPCClient<AppRouter>, BoxClientUnavailable> {
  const missing = REQUIRED_VARS.find((name) => {
    const value = process.env[name];
    return value === undefined || value === "";
  });
  if (missing !== undefined) return err(unavailable(missing));

  // Re-read rather than carry them out of the loop: the check above is the
  // only place that decides a name is present, so there is one rule, not two.
  const serverUrl = (process.env.BBX_SERVER_URL ?? "").replace(/\/+$/, "");
  const boxName = process.env.BBX_BOX_NAME ?? "";
  const token = process.env.BBX_AGENT_TOKEN ?? "";
  return ok(
    createTRPCClient<AppRouter>({
      links: [
        httpLink({
          url: `${serverUrl}/${boxName}/api/trpc`,
          headers: () => ({ Authorization: `Bearer ${token}` }),
        }),
      ],
    }),
  );
}

function unavailable(name: (typeof REQUIRED_VARS)[number]): BoxClientUnavailable {
  return {
    kind: "box-client-unavailable",
    missing: name,
    message:
      `Cannot reach this box's server: ${name} is not set. This command asks the ` +
      "server to do the credentialed work, and that needs the box environment " +
      "(BBX_SERVER_URL, BBX_BOX_NAME, BBX_AGENT_TOKEN). Run it from a box-spawned " +
      "shell, or run it on the server host with the box service's environment.",
  };
}
