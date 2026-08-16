import path from "node:path";

import { z } from "zod";

import { buildApp } from "./app.js";
import { createWorkstreamsCommandService } from "./workstreams-command.js";
import { createDocumentsService } from "./documents-service.js";
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
});

const repoRoot = path.resolve(import.meta.dirname, "../../..");

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
  };
  const app = await buildApp({
    services,
    routerCapability: env.WORKSTREAMS_APP_ROUTER_CAPABILITY,
    basePath: env.WORKSTREAMS_APP_BASE_PATH,
    buildId: env.WORKSTREAMS_APP_BUILD_ID,
    activeJobs: () => actions.activeJobs(),
    logger: true,
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await app.listen({ host: "127.0.0.1", port: env.WORKSTREAMS_APP_PORT });
}

await main();
