/**
 * `bbx pub` — the publication command family. Each subcommand calls the box
 * server, which prepares, stores, and serves publications defined under
 * `src/publications/<name>/` (see `managed.ts`).
 */

import { Command } from "commander";

import {
  pubManagedConnectionsCommand,
  pubManagedIdCommand,
  pubManagedPrepareCommand,
  pubManagedSitesCommand,
  pubManagedStatusCommand,
} from "./managed.js";

export const pubCommand = new Command("pub")
  .description("Prepare box publications and report their serving status (prepare, sites, id, connections, status)")
  .addCommand(pubManagedPrepareCommand)
  .addCommand(pubManagedSitesCommand)
  .addCommand(pubManagedIdCommand)
  .addCommand(pubManagedConnectionsCommand)
  .addCommand(pubManagedStatusCommand);
