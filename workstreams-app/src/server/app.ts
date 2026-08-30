import crypto from "node:crypto";

import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";

import { appRouter } from "./api/router.js";
import { createMutationActivity } from "./mutation-activity.js";
import type { AppServices } from "./services.js";

export const ROUTER_CAPABILITY_HEADER = "x-bbx-workstreams-capability";

function capabilitiesMatch(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function normalizeBasePath(basePath: string): string {
  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/u, "");
  return withoutTrailingSlash || "/";
}

export interface BuildAppOptions {
  services: AppServices;
  routerCapability: string;
  basePath: string;
  buildId: string;
  activeJobs(): number;
  logger?: boolean | undefined;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const basePath = normalizeBasePath(options.basePath);
  const mutationActivity = createMutationActivity();

  await app.register(async (scope) => {
    scope.addHook("onRequest", async (request, reply) => {
      const value = request.headers[ROUTER_CAPABILITY_HEADER];
      const capability = typeof value === "string" ? value : undefined;
      if (!capabilitiesMatch(capability, options.routerCapability)) {
        await reply.code(401).send({ error: "router-capability-required" });
      }
    });

    scope.get("/__internal/health", async () => ({
      status: "ready" as const,
      activeJobs: options.activeJobs() + mutationActivity.active(),
      buildId: options.buildId,
    }));

    await scope.register(fastifyTRPCPlugin<typeof appRouter>, {
      prefix: "/api/trpc",
      trpcOptions: {
        router: appRouter,
        createContext: () => ({ services: options.services, mutationActivity }),
        allowBatching: false,
      },
    });
  }, { prefix: basePath === "/" ? "" : basePath });

  return app;
}
