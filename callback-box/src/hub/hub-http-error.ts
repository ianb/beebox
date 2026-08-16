/** Sanitized raw-route error boundary for the public hub surface. */

import type { FastifyError, FastifyInstance } from "fastify";

export function registerHubErrorHandler(app: FastifyInstance): void {
  // eslint-disable-next-line max-params -- Fastify's callback signature is fixed.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    console.error(`[hub-http] ${request.method} ${request.url} failed (${statusCode}): ${error.message}`);
    reply.status(statusCode).send({ error: statusCode < 500 ? error.message : "Internal server error" });
  });
}
