/**
 * Command registry.
 *
 * Every command the CLI, the webapp, and the reactor can run through
 * `runCommand`. Importing this module registers all of them with
 * `command-runner.ts`; the CLI entry point and the webapp server import it
 * once so registration happens before anything calls `runCommand`.
 */

import { defineRegistry } from "../shared/registry.js";
import { installCommands, type CommandDefinition } from "./command-runner.js";
import { answerCommand } from "./commands/answer.js";
import { attachmentsCommand } from "./commands/attachments.js";
import { connectorSyncCommand } from "./commands/connector-sync.js";
import { createCommand } from "./commands/create.js";
import { dismissCommand } from "./commands/dismiss.js";
import { handleCommand } from "./commands/handle.js";
import { intakeCommand } from "./commands/intake/command.js";
import { lsCommand } from "./commands/ls.js";
import { moveCommand } from "./commands/move/command.js";
import { pdfReanalyzeCommand } from "./commands/pdf-reanalyze.js";
import {
  procedureGcCommand,
  procedureListCommand,
  procedureResumeCommand,
  procedureRunCommand,
  procedureStatusCommand,
} from "./commands/procedure.js";
import { scanImportCommand } from "./commands/scan-import/command.js";
import { searchCommand } from "./commands/search.js";
import { trashCommand } from "./commands/trash/command.js";
import { triageCommand } from "./commands/triage.js";
import { uploadCommand } from "./commands/upload.js";
import { wakeupCommand } from "./commands/wakeup.js";

export const commands = defineRegistry<CommandDefinition>({
  directory: "./commands",
  entry: "command",
  key: (command) => command.name,
  ordered: false,
  members: [
    answerCommand,
    attachmentsCommand,
    connectorSyncCommand,
    createCommand,
    dismissCommand,
    handleCommand,
    intakeCommand,
    lsCommand,
    moveCommand,
    pdfReanalyzeCommand,
    procedureGcCommand,
    procedureListCommand,
    procedureResumeCommand,
    procedureRunCommand,
    procedureStatusCommand,
    scanImportCommand,
    searchCommand,
    trashCommand,
    triageCommand,
    uploadCommand,
    wakeupCommand,
  ],
});

installCommands(commands.list);
