import path from "node:path";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { buildApp } from "./app.js";
import { buildExhibitsApp } from "./exhibits/app.js";
import { defaultStoreRoot } from "./exhibits/store.js";
import { createViteAssets } from "./exhibits/vite-assets.js";
import { createWorkstreamsCommandService } from "./workstreams-command.js";
import { createDocumentsService } from "./documents-service.js";
import { createExhibitsQueueService } from "./exhibits-queue-service.js";
import { createQuotasService } from "./quotas-service.js";
import {
  createActionCommandRunner,
  createActionsService,
} from "./actions-service.js";

const serverEnvSchema = z.object({
  WORKSTREAMS_APP_PORT: z.coerce.number().int().positive().max(65_535),
  WORKSTREAMS_APP_BASE_PATH: z.string().min(1).default("/workstreams"),
  WORKSTREAMS_APP_ROUTER_CAPABILITY: z.string().min(16),
  WORKSTREAMS_APP_BUILD_ID: z.string().min(1).default("dev"),
  // The exhibits surface is a second listener on its own origin (Track B of
  // docs/plans/workstream-exhibits.md). Its token is minted and persisted by
  // the supervisor; a standalone run must supply one too — this origin serves
  // agent-written script, so it never runs unauthenticated.
  EXHIBITS_PORT: z.coerce.number().int().positive().max(65_535).default(3230),
  EXHIBITS_TOKEN: z.string().min(16),
  CALLBACK_EXHIBITS_ROOT: z.string().min(1).optional(),
});

const packageRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = path.resolve(import.meta.dirname, "../../..");

function exhibitsRoots(env: z.infer<typeof serverEnvSchema>): { storeRoot: string; appsRoot: string } {
  return {
    storeRoot: env.CALLBACK_EXHIBITS_ROOT ?? defaultStoreRoot(repoRoot),
    appsRoot: path.join(repoRoot, "dev", "apps"),
  };
}

async function startExhibits(env: z.infer<typeof serverEnvSchema>): Promise<FastifyInstance> {
  const { storeRoot, appsRoot } = exhibitsRoots(env);
  const app = await buildExhibitsApp({
    storeRoot,
    appsRoot,
    token: env.EXHIBITS_TOKEN,
    createAssets: (server) =>
      createViteAssets({
        server,
        frontendRoot: path.join(packageRoot, "src", "frontend", "exhibits"),
        packageRoot,
        repoRoot,
        contentRoots: [storeRoot, appsRoot],
      }),
    logger: true,
  });
  await app.listen({ host: "127.0.0.1", port: env.EXHIBITS_PORT });
  return app;
}

async function main(): Promise<void> {
  const env = serverEnvSchema.parse(process.env);
  const worktreesRoot = process.env.CALLBACK_WORKTREE_ROOT ?? path.join(path.dirname(repoRoot), "callback-worktrees");
  const actions = createActionsService({
    runCommand: createActionCommandRunner(repoRoot),
  });
  const services = {
    workstreams: createWorkstreamsCommandService({ repoRoot }),
    documents: createDocumentsService({ mainRoot: repoRoot, worktreesRoot }),
    quotas: createQuotasService(),
    actions,
    // The queue reads the same store the exhibits listener serves, and links
    // back to its origin: same host, the port that listener binds below.
    exhibits: createExhibitsQueueService({
      ...exhibitsRoots(env),
      origin: `http://127.0.0.1:${String(env.EXHIBITS_PORT)}`,
    }),
  };
  const app = await buildApp({
    services,
    routerCapability: env.WORKSTREAMS_APP_ROUTER_CAPABILITY,
    basePath: env.WORKSTREAMS_APP_BASE_PATH,
    buildId: env.WORKSTREAMS_APP_BUILD_ID,
    activeJobs: () => actions.activeJobs(),
    logger: true,
  });

  const exhibits = await startExhibits(env);

  const shutdown = async (): Promise<void> => {
    await Promise.allSettled([app.close(), exhibits.close()]);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await app.listen({ host: "127.0.0.1", port: env.WORKSTREAMS_APP_PORT });
}

await main();
