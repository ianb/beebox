/**
 * `bbx pub` — the publication command family. Each subcommand calls the box
 * server, which prepares, stores, and serves publications defined by
 * `<Name>.publication.card` cards (see `managed.ts`).
 */

import { Command } from "commander";

import {
  pubManagedCatCommand,
  pubManagedFilesCommand,
  pubManagedIdCommand,
  pubManagedPrepareCommand,
  pubManagedStatusCommand,
} from "./managed.js";

export const pubCommand = new Command("pub")
  .description("Prepare box publications and report their serving status (prepare <card>, id, status) and read published release files (files <card>, cat <card> <file>)")
  .addCommand(pubManagedPrepareCommand)
  .addCommand(pubManagedIdCommand)
  .addCommand(pubManagedStatusCommand)
  .addCommand(pubManagedFilesCommand)
  .addCommand(pubManagedCatCommand);
