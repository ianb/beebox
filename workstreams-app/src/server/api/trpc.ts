import { initTRPC } from "@trpc/server";

import type { AppServices } from "../services.js";

export interface AppContext {
  services: AppServices;
}

const trpc = initTRPC.context<AppContext>().create();

export const procedure = trpc.procedure;
export const router = trpc.router;
