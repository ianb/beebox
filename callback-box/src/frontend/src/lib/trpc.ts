import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@backend/trpc/router.js";

export const trpc = createTRPCReact<AppRouter>();

/** Inferred output types from the tRPC router */
export type RouterOutput = inferRouterOutputs<AppRouter>;
