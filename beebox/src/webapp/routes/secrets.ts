/**
 * The loopback secret resolver: the ONE interface that discloses a stored value
 * to box code running outside a server process (`docs/implemented-plans/secret-custody.md`,
 * Track 2, "Access levels on grants").
 *
 * POST /api/secrets/resolve  { name, purpose } -> { value, suspect }
 *
 * Agent-authored code — a trick, a scheduled script, a procedure step — that
 * integrates a service of its own needs the credential at the moment it makes
 * the outbound call. It asks its OWN box over the loopback API, exactly the way
 * `bbx chat self-note` already does, and the server process resolves the grant.
 * The value lives transiently in the caller's memory; it is never written to
 * env, a file, or a log.
 *
 * Two properties make this a raw Fastify route rather than a tRPC procedure:
 *
 * 1. **It requires the AGENT auth source specifically.** The tRPC context
 *    collapses every credential — session cookie, hub identity header, mobile
 *    token, browse key, agent bearer — into one `authed` boolean
 *    (`server-box-scope.ts`), so an `authedProcedure` here would disclose
 *    `agent`-granted values to any browser session that could reach the box.
 *    This route calls {@link verifyAgentBearer} itself and accepts NOTHING
 *    else: a cookie, a hub header, or a browse key gets 401 even on a box
 *    served in open-access mode.
 * 2. **Its refusals are the store's typed refusals, verbatim.** The whole point
 *    of the refusal vocabulary is that the agent can read the message and route
 *    the fix (ask the boxholder to grant it, to raise the grant to agent
 *    access, to supply a value). A tRPC error would flatten `kind` into a
 *    stringly-typed message.
 *
 * Honest scope, as everywhere in this plan: "own box only" is exactly as strong
 * as containment. The agent token is a 0600 file inside the box tree, so box A
 * reading box B's token is the out-of-tree act the containment deny rules exist
 * to stop — not something this route can prevent.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyAgentBearer } from "../../core/agent/token.js";
import { resolveSecret, SECRET_PURPOSE_PATTERN } from "../../core/secrets/resolve.js";
import type { SecretRefusalKind } from "../../core/secrets/errors.js";
import { assertNever } from "../../lib/invariant.js";

/**
 * Both fields are required and bounded: `purpose` is written verbatim into the
 * access log, so it is constrained to a short label ("weather-trick") — never a
 * payload. The pattern is the resolver's own
 * ({@link SECRET_PURPOSE_PATTERN}); rejecting here means the internal
 * invariant behind it is never the thing that fails on caller input.
 */
const resolveBodySchema = z.object({
  name: z.string().min(1).max(200),
  purpose: z
    .string()
    .regex(
      SECRET_PURPOSE_PATTERN,
      "purpose must be a short label: lowercase letters, digits and dashes, 40 characters max, e.g. weather-trick",
    ),
});

/**
 * HTTP status per refusal kind:
 *
 * - **403** — the secret exists and this box may not have it (`not-granted`,
 *   `agent-access-not-granted`). A boxholder decision stands between the caller
 *   and the value.
 * - **404** — there is no value to be had under that name for this box
 *   (`unknown-secret`, `empty-slot`, `dangling-grant`). Nothing is being
 *   withheld; the slot is missing, empty, or stale.
 * - **503** — the machine's store could not be read (`store-unreadable`). Not
 *   the caller's fault and not the caller's to fix, and the box's own auth
 *   layer already answers 503 for an unreadable credential store.
 */
function statusForRefusal(kind: SecretRefusalKind): number {
  switch (kind) {
    case "not-granted":
    case "agent-access-not-granted":
      return 403;
    case "unknown-secret":
    case "empty-slot":
    case "dangling-grant":
      return 404;
    case "store-unreadable":
      return 503;
    default:
      return assertNever(kind);
  }
}

export function registerSecretsRoutes(opts: {
  server: FastifyInstance;
  boxRoot: string;
  boxSlug: string;
}): void {
  const { server, boxRoot, boxSlug } = opts;

  server.post<{ Body: unknown }>("/api/secrets/resolve", async (request, reply) => {
    if (!verifyAgentBearer(boxRoot, request.headers["authorization"])) {
      return reply.status(401).send({
        kind: "not-agent-authenticated",
        message:
          "Resolving a secret requires this box's agent token — send it as " +
          "`Authorization: Bearer $BBX_AGENT_TOKEN` from code running in the box. A browser " +
          "session, a hub identity header, or a device token is deliberately not enough: " +
          "this is the only interface that discloses a stored value, so it accepts only the " +
          "box's own code.",
      });
    }
    const parsed = resolveBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        kind: "bad-request",
        message: `Expected a JSON body of {name, purpose}: ${parsed.error.issues[0]?.message ?? "invalid body"}`,
      });
    }
    const { name, purpose } = parsed.data;
    const resolved = await resolveSecret({ boxRoot, slug: boxSlug, name, purpose, access: "agent" });
    if (!resolved.ok) {
      return reply
        .status(statusForRefusal(resolved.error.kind))
        .send({ kind: resolved.error.kind, message: resolved.error.message });
    }
    return reply.send({ value: resolved.value.value, suspect: resolved.value.suspect });
  });
}
