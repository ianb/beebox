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
import { ttsRouter } from "./routers/tts.js";
import { voiceRouter } from "./routers/voice.js";
import { landmarksRouter } from "./routers/landmarks.js";
import { navRouter } from "./routers/nav.js";
import { chatRouter } from "./routers/chat.js";
import { eventsRouter } from "./routers/events.js";
import { locationRouter } from "./routers/location.js";
import { pushRouter } from "./routers/push.js";
import { viewsRouter } from "./routers/views.js";
import { clerkRouter } from "./routers/clerk.js";
import { pairingRouter } from "./routers/pairing.js";
import { captureRouter } from "./routers/capture.js";
import { scanTokensRouter } from "./routers/scan-tokens.js";
import { shareRouter } from "./routers/share.js";
import { inventoryRouter } from "./routers/inventory.js";
import { secretsRouter } from "./routers/secrets.js";
import { presentationRouter } from "./routers/presentation.js";

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
  tts: ttsRouter,
  voice: voiceRouter,
  landmarks: landmarksRouter,
  nav: navRouter,
  chat: chatRouter,
  events: eventsRouter,
  location: locationRouter,
  push: pushRouter,
  views: viewsRouter,
  clerk: clerkRouter,
  pairing: pairingRouter,
  capture: captureRouter,
  scanTokens: scanTokensRouter,
  share: shareRouter,
  inventory: inventoryRouter,
  secrets: secretsRouter,
  presentation: presentationRouter,
});

export type AppRouter = typeof appRouter;
