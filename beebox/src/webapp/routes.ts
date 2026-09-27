/**
 * Route registry.
 *
 * `src/webapp/routes/` is a set directory: one member per route module, a
 * flat `<name>.ts` file or a `<name>/register.ts` unit when a route needs
 * more than one file. This registry exists for rule 1/4 completeness only —
 * each register function's options differ too much for a uniform call site,
 * so `server/app.ts` and `server-box-scope.ts` keep importing and invoking
 * them directly by their new paths.
 */
import { defineRegistry } from "../shared/registry.js";
import { registerActionRoutes } from "./routes/actions.js";
import { registerGoogleServicesCallback } from "./routes/admin.js";
import { registerApiRoutes } from "./routes/api/register.js";
import { registerCspReportRoute } from "./routes/api-csp-report.js";
import { registerAuthSurface } from "./routes/auth/register.js";
import { registerBoxIdentityAssetRoutes } from "./routes/box-identity-assets.js";
import { registerBulkUploadRoutes } from "./routes/bulk-upload/register.js";
import { registerCaptureRoutes } from "./routes/capture/register.js";
import { registerCardSubmissionRoutes } from "./routes/card-submission.js";
import { registerChatRoutes } from "./routes/chat/register.js";
import { registerCommandRoutes } from "./routes/commands.js";
import { registerFigureRoutes } from "./routes/figure.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerPairingRoutes } from "./routes/pairing.js";
import { registerScanUploadRoutes } from "./routes/scan-upload/register.js";
import { registerSecretsRoutes } from "./routes/secrets.js";
import { registerTelegramRoutes } from "./routes/telegram.js";
import { registerViewRoutes } from "./routes/views.js";

/**
 * Loose on purpose: every route module's registration signature differs
 * (server-first, options-first, sync, async), and `never` rest parameters
 * are the sound way to accept any of them without `any` — a target
 * parameter type of `never` is assignable to any concrete parameter type.
 */
export type RouteRegistrar = (...args: never[]) => void | Promise<void>;

const routeMembers: Record<string, RouteRegistrar> = {
  actions: registerActionRoutes,
  admin: registerGoogleServicesCallback,
  api: registerApiRoutes,
  apiCspReport: registerCspReportRoute,
  auth: registerAuthSurface,
  boxIdentityAssets: registerBoxIdentityAssetRoutes,
  bulkUpload: registerBulkUploadRoutes,
  capture: registerCaptureRoutes,
  cardSubmission: registerCardSubmissionRoutes,
  chat: registerChatRoutes,
  commands: registerCommandRoutes,
  figure: registerFigureRoutes,
  history: registerHistoryRoutes,
  pairing: registerPairingRoutes,
  scanUpload: registerScanUploadRoutes,
  secrets: registerSecretsRoutes,
  telegram: registerTelegramRoutes,
  views: registerViewRoutes,
};

export const routes = defineRegistry<RouteRegistrar>({
  directory: "./routes",
  entry: "register",
  ordered: false,
  members: routeMembers,
});
