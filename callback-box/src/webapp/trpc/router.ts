import { router } from "./trpc.js";
import { historyRouter } from "./routers/history.js";
import { statusRouter } from "./routers/status.js";
import { cardRouter } from "./routers/card.js";
import { schedulerRouter } from "./routers/scheduler.js";
import { calendarRouter } from "./routers/calendar.js";
import { pairingRouter } from "./routers/pairing.js";
import { actionsRouter } from "./routers/actions.js";
import { briefsRouter } from "./routers/briefs.js";
import { chatRouter } from "./routers/chat.js";
import { commandsRouter } from "./routers/commands.js";
import { debugLogRouter } from "./routers/debugLog.js";
import { adminRouter } from "./routers/admin.js";

export const appRouter = router({
  history: historyRouter,
  status: statusRouter,
  card: cardRouter,
  scheduler: schedulerRouter,
  calendar: calendarRouter,
  pairing: pairingRouter,
  actions: actionsRouter,
  briefs: briefsRouter,
  chat: chatRouter,
  commands: commandsRouter,
  debugLog: debugLogRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
