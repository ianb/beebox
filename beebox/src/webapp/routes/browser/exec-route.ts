/**
 * `POST /<slug>/api/browser/exec`: the agent's way into the box browser
 * (docs/plans/shared-browser.md, Track C, and the "Exec route" ontology entry).
 *
 * `bbx browser <args>` posts `{ args }` here. The route checks the arguments
 * against the refused-flag list (a flag that picks another profile or browser
 * would leave the box browser), makes sure the browser host is running, and
 * hands the arguments to the host's command socket, which runs agent-browser
 * inside the host and answers `{ exitCode, stdout, stderr }`.
 *
 * Auth: the box auth wall admits five credentials; this route accepts only
 * the per-box agent bearer. People reach the same browser through the
 * Browser item in the profile menu, and a page with the person's cookie must
 * not be able to drive it.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyAgentBearer } from "../../../core/agent/token.js";
import { sendBrowserCommand, BrowserCommandSocketError } from "../../../core/browser/command-socket.js";
import { checkExecArgs, EXEC_BODY } from "../../../core/browser/exec-args.js";
import { BrowserHostFailedError, BrowserNotInstalledError, ensureBrowserHost } from "../../../core/browser/host/start.js";
import { BrowserPathTooLongError } from "../../../core/browser/paths.js";
import type { Services } from "../../../services/container.js";

export interface BrowserExecRouteContext {
  readonly server: FastifyInstance;
  readonly boxRoot: string;
  readonly services: Services;
}

/** The status and `{ error }` body for a failure to reach the host, or null for an unexpected error. */
function hostFailure(e: unknown): { status: number; error: string } | null {
  if (e instanceof BrowserNotInstalledError || e instanceof BrowserPathTooLongError) return { status: 503, error: e.message };
  if (e instanceof BrowserHostFailedError || e instanceof BrowserCommandSocketError) return { status: 502, error: e.message };
  return null;
}

export function registerBrowserExecRoute(ctx: BrowserExecRouteContext): void {
  const { server, boxRoot, services } = ctx;
  const ensureHost = services.browserHost ?? ensureBrowserHost;

  server.post<{ Body: unknown }>("/api/browser/exec", async (request, reply) => {
    if (!verifyAgentBearer(boxRoot, request.headers["authorization"])) {
      return reply.status(403).send({
        error: "The browser exec route is for the box's agent (bbx browser); people open the browser from the profile menu's Browser item",
      });
    }
    const body = EXEC_BODY.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: `bbx browser: ${z.prettifyError(body.error)}` });
    }
    const check = checkExecArgs(body.data.args);
    if (!check.ok) return reply.status(400).send({ error: check.message });
    try {
      const host = await ensureHost({ boxRoot });
      return reply.status(200).send(await sendBrowserCommand(host.paths.cliSocket, body.data.args));
    } catch (e) {
      const failure = hostFailure(e);
      if (failure === null) throw e;
      return reply.status(failure.status).send({ error: failure.error });
    }
  });
}
