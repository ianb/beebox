/**
 * tRPC router registry.
 *
 * `src/webapp/trpc/routers/` is a set directory: one member per router, a
 * flat `<name>.ts` file or a `<name>/router.ts` unit when a router needs more
 * than one file. Per the plan's "Record keys" rule (`docs/plans/file-layout.md`,
 * rule 4), a record-form registry's keys must equal each member's file or
 * directory name in camelCase — the same identifier tRPC's public procedure
 * names already use (`quick-chat.ts` -> `quickChat`). `routerMembers` is the
 * one object literal both `defineRegistry` (completeness) and `router(...)`
 * (the actual `appRouter`) are built from, so there is only one list to keep
 * in sync, not two.
 */
import type { AnyRouter } from "@trpc/server";
import { defineRegistry } from "../../shared/registry.js";
import { router } from "./procedures.js";
import { quickChatRouter } from "./routers/quick-chat.js";
import { historyRouter } from "./routers/history.js";
import { statusRouter } from "./routers/status.js";
import { cardRouter } from "./routers/card.js";
import { schedulerRouter } from "./routers/scheduler/router.js";
import { calendarRouter } from "./routers/calendar.js";
import { actionsRouter } from "./routers/actions.js";
import { commandsRouter } from "./routers/commands.js";
import { debugLogRouter } from "./routers/debug-log.js";
import { adminRouter } from "./routers/admin/router.js";
import { agentsRouter } from "./routers/agents.js";
import { collectionsRouter } from "./routers/collections.js";
import { healthRouter } from "./routers/health/router.js";
import { driveRouter } from "./routers/drive.js";
import { filesRouter } from "./routers/files/router.js";
import { transcriptionRouter } from "./routers/transcription.js";
import { ttsRouter } from "./routers/tts.js";
import { voiceRouter } from "./routers/voice.js";
import { landmarksRouter } from "./routers/landmarks/router.js";
import { navRouter } from "./routers/nav.js";
import { chatRouter } from "./routers/chat/router.js";
import { eventsRouter } from "./routers/events.js";
import { locationRouter } from "./routers/location.js";
import { pushRouter } from "./routers/push.js";
import { viewsRouter } from "./routers/views.js";
import { clerkRouter } from "./routers/clerk.js";
import { browserTaskRouter } from "./routers/browser-task.js";
import { pairingRouter } from "./routers/pairing.js";
import { captureRouter } from "./routers/capture.js";
import { scanTokensRouter } from "./routers/scan-tokens.js";
import { shareRouter } from "./routers/share/router.js";
import { inventoryRouter } from "./routers/inventory.js";
import { secretsRouter } from "./routers/secrets.js";
import { presentationRouter } from "./routers/presentation.js";
import { voiceRecordingRouter } from "./routers/voice-recording.js";
import { wakeupRouter } from "./routers/wakeup.js";
import { gmailRouter } from "./routers/gmail.js";
import { searchRouter } from "./routers/search.js";
import { cloudflarePublishConnectionsRouter } from "./routers/cloudflare-publish-connections.js";
import { publicationsRouter } from "./routers/publications.js";
import { todosRouter } from "./routers/todos.js";
import { presenceRouter } from "./routers/presence.js";
import { notificationsRouter } from "./routers/notifications.js";

const routerMembers = {
  quickChat: quickChatRouter,
  history: historyRouter,
  status: statusRouter,
  card: cardRouter,
  scheduler: schedulerRouter,
  calendar: calendarRouter,
  actions: actionsRouter,
  commands: commandsRouter,
  debugLog: debugLogRouter,
  admin: adminRouter,
  agents: agentsRouter,
  collections: collectionsRouter,
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
  browserTask: browserTaskRouter,
  pairing: pairingRouter,
  capture: captureRouter,
  scanTokens: scanTokensRouter,
  share: shareRouter,
  inventory: inventoryRouter,
  secrets: secretsRouter,
  cloudflarePublishConnections: cloudflarePublishConnectionsRouter,
  publications: publicationsRouter,
  presentation: presentationRouter,
  voiceRecording: voiceRecordingRouter,
  wakeup: wakeupRouter,
  gmail: gmailRouter,
  search: searchRouter,
  todos: todosRouter,
  presence: presenceRouter,
  notifications: notificationsRouter,
};

export const routers = defineRegistry<AnyRouter>({
  directory: "./routers",
  entry: "router",
  ordered: false,
  members: routerMembers,
});

export const appRouter = router(routerMembers);

export type AppRouter = typeof appRouter;
