import { router } from "./trpc.js";
import { historyRouter } from "./routers/history.js";
import { statusRouter } from "./routers/status.js";
import { cardRouter } from "./routers/card.js";
import { schedulerRouter } from "./routers/scheduler.js";
import { calendarRouter } from "./routers/calendar.js";
import { actionsRouter } from "./routers/actions.js";
import { commandsRouter } from "./routers/commands.js";
import { debugLogRouter } from "./routers/debugLog.js";
import { adminRouter } from "./routers/admin.js";
import { todosRouter } from "./routers/todos.js";
import { healthRouter } from "./routers/health.js";
import { driveRouter } from "./routers/drive.js";
import { filesRouter } from "./routers/files.js";
import { transcriptionRouter } from "./routers/transcription.js";
import { landmarksRouter } from "./routers/landmarks.js";
import { chatRouter } from "./routers/chat.js";
import { eventsRouter } from "./routers/events.js";
import { locationRouter } from "./routers/location.js";

export const appRouter = router({
  history: historyRouter,
  status: statusRouter,
  card: cardRouter,
  scheduler: schedulerRouter,
  calendar: calendarRouter,
  actions: actionsRouter,
  commands: commandsRouter,
  debugLog: debugLogRouter,
  admin: adminRouter,
  todos: todosRouter,
  health: healthRouter,
  drive: driveRouter,
  files: filesRouter,
  transcription: transcriptionRouter,
  landmarks: landmarksRouter,
  chat: chatRouter,
  events: eventsRouter,
  location: locationRouter,
});

export type AppRouter = typeof appRouter;
