/**
 * Google Drive type-handler registry.
 *
 * Each handler covers a set of Google mimeTypes and knows how to inspect,
 * pull, and push a file of that type (contract: `./types.js`'s
 * `DriveTypeHandler`). `defineRegistry` replaces the former mutable array
 * that `registerDriveHandler` populated as a side effect of each handler
 * module's own import — existence no longer depends on some caller having
 * imported the handler module first. Rules: docs/plans/file-layout.md,
 * rule 4.
 */
import { defineRegistry } from "../../shared/registry.js";
import type { DriveTypeHandler } from "./types.js";
import { docsHandler } from "./handlers/docs/handler.js";
import { sheetsHandler } from "./handlers/sheets/handler.js";

const driveHandlers = defineRegistry<DriveTypeHandler>({
  directory: "./handlers",
  entry: "handler",
  ordered: false,
  members: { docs: docsHandler, sheets: sheetsHandler },
});

export function getHandlerForMimeType(mimeType: string): DriveTypeHandler | undefined {
  return driveHandlers.list.find((handler) => handler.mimeTypes.includes(mimeType));
}

export function getAllDriveHandlers(): DriveTypeHandler[] {
  return [...driveHandlers.list];
}
