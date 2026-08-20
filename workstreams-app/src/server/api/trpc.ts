import { initTRPC } from "@trpc/server";

import type { AppServices } from "../services.js";
import type { MutationActivity } from "../mutation-activity.js";

export interface AppContext {
  services: AppServices;
  mutationActivity: MutationActivity;
}

const trpc = initTRPC.context<AppContext>().create();

export const procedure = trpc.procedure.use(async ({ ctx, next, type }) => {
  if (type !== "mutation") return next();
  const finish = ctx.mutationActivity.start();
  try {
    return await next();
  } finally {
    finish();
  }
});
export const router = trpc.router;
