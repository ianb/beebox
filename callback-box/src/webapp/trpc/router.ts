import { router } from "./trpc.js";
import { historyRouter } from "./routers/history.js";

export const appRouter = router({
  history: historyRouter,
});

export type AppRouter = typeof appRouter;
