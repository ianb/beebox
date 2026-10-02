/**
 * Connector registry.
 *
 * Connectors bridge external services to the filesystem. Each connector
 * syncs external state with the repo (pull + push) and transforms between
 * external formats and cards. The contract itself (`Connector`, `SyncResult`,
 * `ConnectorFatalError`, ...) lives in `./connector.js`, not here — a set
 * member may not import its own registry (rule 1, docs/plans/file-layout.md),
 * so the types every member needs live in a module the registry can import
 * without creating a cycle back into itself.
 *
 * `connectorFactories` is the set's registry (rule 4): each member is the
 * subsystem's `create*Connector` factory, keyed by its own name. It replaces
 * the former mutable `Map` that `registerConnector` populated as a side
 * effect of calling a factory — existence no longer depends on some caller
 * having constructed a connector first.
 */
import { defineRegistry } from "./shared/registry.js";
import type { Connector } from "./connector.js";
import { createGmailConnector } from "./connectors/gmail/connector.js";
import { createGoogleDriveConnector } from "./connectors/google-drive/connector.js";
import { createGoogleCalendarConnector } from "./connectors/google-calendar/connector.js";
import { createTelegramConnector } from "./connectors/telegram/connector.js";
import { createPublishSubmissionsConnector } from "./connectors/publish-submissions.js";

export type {
  Connector,
  SyncResult,
  SyncSkipped,
  ConnectorProcedureTrigger,
} from "./connector.js";
export { ConnectorFatalError } from "./connector.js";

/** A subsystem's connector constructor. Called with the box root; extra
 * optional parameters (a fake service for tests) are the factory's own. */
export type ConnectorFactory = (boxRoot: string) => Connector;

export const connectorFactories = defineRegistry<ConnectorFactory>({
  directory: "./connectors",
  entry: "connector",
  // Order is semantics: a full wakeup runs connectors in this order, which is
  // the order they self-registered in before this registry existed.
  ordered: true,
  members: {
    gmail: createGmailConnector,
    googleCalendar: createGoogleCalendarConnector,
    telegram: createTelegramConnector,
    googleDrive: createGoogleDriveConnector,
    publishSubmissions: createPublishSubmissionsConnector,
  },
});
