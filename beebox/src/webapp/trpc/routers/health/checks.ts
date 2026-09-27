/**
 * Health check registry.
 *
 * `health/checks/` is a sub-set within the `trpc/routers/` set: each member
 * is a namespace of health-check functions (most export one or more
 * `HealthCheck`/`HealthCheck[]`-returning functions). This registry exists
 * for rule 1/4 completeness only — `health/router.ts` keeps importing the
 * specific named exports it needs directly from `./checks/*.js`. The two
 * owner-only tRPC procedures that used to live beside the box-growth check
 * moved to `./procedures.ts` instead: they are not checks, so they are not a
 * member of this set (see `health/procedures.ts`).
 */
import { defineRegistry } from "../../../../shared/registry.js";
import * as annex from "./checks/annex.js";
import * as claudeAuth from "./checks/claude-auth.js";
import * as connectors from "./checks/connectors.js";
import * as engine from "./checks/engine.js";
import * as gitLock from "./checks/git-lock.js";
import * as google from "./checks/google.js";
import * as hostPackages from "./checks/host-packages.js";
import * as migrations from "./checks/migrations.js";
import * as modelRoutes from "./checks/model-routes.js";
import * as packageDocs from "./checks/package-docs.js";
import * as scanUploaders from "./checks/scan-uploaders.js";
import * as schedules from "./checks/schedules.js";
import * as secrets from "./checks/secrets.js";
import * as snapshot from "./checks/snapshot.js";
import * as stale from "./checks/stale.js";
import * as templates from "./checks/templates.js";
import * as todos from "./checks/todos.js";
import * as watchLimit from "./checks/watch-limit.js";
import * as writability from "./checks/writability.js";

/** Deliberately loose: the checks/* modules share no single value shape, only the namespace. */
export type HealthCheckModule = Record<string, unknown>;

export const healthChecks = defineRegistry<HealthCheckModule>({
  directory: "./checks",
  ordered: false,
  members: {
    annex: annex,
    claudeAuth: claudeAuth,
    connectors: connectors,
    engine: engine,
    gitLock: gitLock,
    google: google,
    hostPackages: hostPackages,
    migrations: migrations,
    modelRoutes: modelRoutes,
    packageDocs: packageDocs,
    scanUploaders: scanUploaders,
    schedules: schedules,
    secrets: secrets,
    snapshot: snapshot,
    stale: stale,
    templates: templates,
    todos: todos,
    watchLimit: watchLimit,
    writability: writability,
  },
});
