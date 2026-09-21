/**
 * Every `Command` the CLI registers, addressable by the verb a person types.
 *
 * Keyed at runtime off each command's own `name()` rather than by a hand-written
 * name → export mapping, which would be a second place for a verb's name to
 * live and a second place to get it wrong. `surface-build.ts` fails loudly when
 * the surface table names a verb that is absent here, and
 * `test/cli/surface.doctest.md` fails when a verb here is absent from the table
 * — so a new command cannot be registered without being classified.
 *
 * Imported per module rather than through `commands/index.js`: that barrel
 * exists, but the ruleset bans adding consumers to one (code-style.md, "No
 * barrels"), and this file is where its last caller can eventually be removed.
 */

import type { Command } from "commander";
import { maintenanceCommand } from "./commands/maintenance.js";
import { initCommand } from "./commands/init.js";
import { migrateCommand } from "./commands/migrate.js";
import { docsCommand } from "./commands/docs.js";
import { upgradeCommand } from "./commands/upgrade.js";
import { statusCommand } from "./commands/status.js";
import { validateCommand } from "./commands/validate.js";
import { agentContextCommand } from "./commands/agent-context.js";
import { createCommand } from "./commands/create.js";
import { serveCommand } from "./commands/serve.js";
import { hubCommand } from "./commands/hub.js";
import { answerCommand } from "./commands/answer.js";
import { dismissCommand } from "./commands/dismiss.js";
import { wakeupCommand } from "./commands/wakeup.js";
import { forceWakeupCommand } from "./commands/force-wakeup.js";
import { trashCommand } from "./commands/trash.js";
import { moveCommand } from "./commands/move.js";
import { relinkCommand } from "./commands/relink.js";
import { migrateViewLinksCommand } from "./commands/migrate-view-links.js";
import { procedureCommand } from "./commands/procedure.js";
import { authCommand } from "./commands/auth.js";
import { secretsCommand } from "./commands/secrets.js";
import { googleAuthCommand } from "./commands/google-auth.js";
import { calendarCommand } from "./commands/calendar.js";
import { finishCommand } from "./commands/finish.js";
import { reactorCommand } from "./commands/reactor.js";
import { fieldTestCommand } from "./commands/field-test.js";
import { tickCommand } from "./commands/tick.js";
import { scheduledCommand } from "./commands/scheduled.js";
import { healthCommand } from "./commands/health.js";
import { hostCommand } from "./commands/host.js";
import { doctorCommand } from "./commands/doctor.js";
import { activityCommand } from "./commands/activity.js";
import { trickCommand } from "./commands/trick.js";
import { finalizeCommand } from "./commands/finalize.js";
import { sessionCommand } from "./commands/session.js";
import { schedulerCommand } from "./commands/scheduler.js";
import { scanImportCommand } from "./commands/scan-import.js";
import { pdfCommand } from "./commands/pdf.js";
import { uploadCommand } from "./commands/upload.js";
import { attachmentsCommand } from "./commands/attachments.js";
import { lsCommand } from "./commands/ls.js";
import { searchCommand } from "./commands/search.js";
import { containsCommand } from "./commands/contains.js";
import { pubCommand } from "./commands/pub.js";
import { viewCommand } from "./commands/view.js";
import { usageCommand } from "./commands/usage.js";
import { driveCommand } from "./commands/drive.js";
import { chatCommand } from "./commands/chat.js";
import { refreshMapsCommand } from "./commands/refresh-maps.js";
import { retroCommand } from "./commands/retro.js";
import { boxesCommand } from "./commands/boxes.js";
import { intakeCommand } from "./commands/intake.js";
import { triageCommand } from "./commands/triage.js";
import { handleCommand } from "./commands/handle.js";
import { extfileCommand } from "./commands/extfile.js";
import { locationCommand } from "./commands/location.js";
import { pushCommand } from "./commands/push.js";
import { tailscaleCommand } from "./commands/tailscale.js";
import { todosCommand } from "./commands/todos.js";
import { queryCommand } from "./commands/query.js";
import { connectorCommand } from "./commands/connector.js";

/** Registration order is irrelevant — the surface table decides placement. */
const ALL: readonly Command[] = [
  maintenanceCommand,
  initCommand,
  migrateCommand,
  docsCommand,
  upgradeCommand,
  statusCommand,
  validateCommand,
  agentContextCommand,
  createCommand,
  serveCommand,
  hubCommand,
  answerCommand,
  dismissCommand,
  wakeupCommand,
  forceWakeupCommand,
  trashCommand,
  moveCommand,
  relinkCommand,
  migrateViewLinksCommand,
  procedureCommand,
  authCommand,
  secretsCommand,
  googleAuthCommand,
  calendarCommand,
  finishCommand,
  reactorCommand,
  fieldTestCommand,
  tickCommand,
  scheduledCommand,
  healthCommand,
  hostCommand,
  doctorCommand,
  activityCommand,
  trickCommand,
  finalizeCommand,
  sessionCommand,
  schedulerCommand,
  scanImportCommand,
  pdfCommand,
  uploadCommand,
  attachmentsCommand,
  lsCommand,
  searchCommand,
  containsCommand,
  pubCommand,
  viewCommand,
  usageCommand,
  driveCommand,
  chatCommand,
  refreshMapsCommand,
  retroCommand,
  boxesCommand,
  intakeCommand,
  triageCommand,
  handleCommand,
  extfileCommand,
  locationCommand,
  pushCommand,
  tailscaleCommand,
  todosCommand,
  queryCommand,
  connectorCommand,
];

/** Verb name (`bbx <name>`) to its command. */
export const VERB_COMMANDS: Readonly<Record<string, Command>> = Object.fromEntries(
  ALL.map((command) => [command.name(), command]),
);
