/**
 * Command registry.
 *
 * Every command the CLI, the webapp, and the reactor can run through
 * `runCommand`. `command-runner.ts` (the lookups: `getCommand`, `runCommand`,
 * `listCommands`) imports this module at its own load, so importing any
 * lookup is what loads every command below — no consumer needs a bare
 * side-effect `import "./commands.js"`.
 */

import { defineRegistry } from "../shared/registry.js";
import type { CommandDefinition } from "./command-types.js";
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
  // Order is semantics: `listCommands()` returns this list and the webapp's
  // commands router serves it as-is. It is the order the commands registered
  // in (the old barrel's import order) before this registry existed.
  ordered: true,
  members: [
    createCommand,
    connectorSyncCommand,
    answerCommand,
    dismissCommand,
    trashCommand,
    moveCommand,
    procedureRunCommand,
    procedureResumeCommand,
    procedureListCommand,
    procedureGcCommand,
    procedureStatusCommand,
    scanImportCommand,
    pdfReanalyzeCommand,
    uploadCommand,
    attachmentsCommand,
    lsCommand,
    searchCommand,
    wakeupCommand,
    intakeCommand,
    triageCommand,
    handleCommand,
  ],
});
