/**
 * Every command the CLI registers, as a loader keyed by the verb a person types.
 *
 * A key is the command module's file or directory name in camelCase, and every
 * module is named for its verb, so a key is `verbRegistryKey(verb)`
 * (`entry/select-verb.ts`): the verb's name lives in its file name and its
 * `Command`, and `test/cli/entry.surface.test.ts` loads every member and checks
 * the two agree. `entry/surface-build.ts` fails loudly when the surface table
 * names a verb that is absent here, and the surface test fails when a verb
 * here is absent from the table — so a new command cannot be registered
 * without being classified.
 *
 * A `bbx` run loads only the verb it names (`entry/load-commands.ts`). The
 * bundle is code-split, so the other command modules, and the npm packages
 * only they import, are never read.
 */

import type { Command } from "commander";
import { defineRegistry } from "../shared/registry.js";

/** Imports one command module and returns its command. */
export type CommandLoader = () => Promise<Command>;

/** Registry key to the loader of that verb's command. */
export const VERB_COMMANDS = defineRegistry<CommandLoader>({
  directory: "./commands",
  entry: "command",
  ordered: false,
  members: {
    activity: async () => (await import("./commands/activity.js")).activityCommand,
    agentContext: async () => (await import("./commands/agent-context.js")).agentContextCommand,
    answer: async () => (await import("./commands/answer.js")).answerCommand,
    attachments: async () => (await import("./commands/attachments.js")).attachmentsCommand,
    auth: async () => (await import("./commands/auth.js")).authCommand,
    boxes: async () => (await import("./commands/boxes.js")).boxesCommand,
    calendar: async () => (await import("./commands/calendar.js")).calendarCommand,
    changes: async () => (await import("./commands/changes.js")).changesCommand,
    chat: async () => (await import("./commands/chat/command.js")).chatCommand,
    connector: async () => (await import("./commands/connector.js")).connectorCommand,
    contains: async () => (await import("./commands/contains.js")).containsCommand,
    create: async () => (await import("./commands/create.js")).createCommand,
    dismiss: async () => (await import("./commands/dismiss.js")).dismissCommand,
    docs: async () => (await import("./commands/docs.js")).docsCommand,
    doctor: async () => (await import("./commands/doctor.js")).doctorCommand,
    drive: async () => (await import("./commands/drive/command.js")).driveCommand,
    extfile: async () => (await import("./commands/extfile.js")).extfileCommand,
    fieldTest: async () => (await import("./commands/field-test.js")).fieldTestCommand,
    finalize: async () => (await import("./commands/finalize.js")).finalizeCommand,
    finish: async () => (await import("./commands/finish.js")).finishCommand,
    forceWakeup: async () => (await import("./commands/force-wakeup.js")).forceWakeupCommand,
    googleAuth: async () => (await import("./commands/google-auth.js")).googleAuthCommand,
    handle: async () => (await import("./commands/handle.js")).handleCommand,
    health: async () => (await import("./commands/health.js")).healthCommand,
    host: async () => (await import("./commands/host.js")).hostCommand,
    hub: async () => (await import("./commands/hub.js")).hubCommand,
    init: async () => (await import("./commands/init.js")).initCommand,
    intake: async () => (await import("./commands/intake.js")).intakeCommand,
    judge: async () => (await import("./commands/judge/command.js")).judgeCommand,
    location: async () => (await import("./commands/location.js")).locationCommand,
    ls: async () => (await import("./commands/ls.js")).lsCommand,
    maintenance: async () => (await import("./commands/maintenance/command.js")).maintenanceCommand,
    migrate: async () => (await import("./commands/migrate.js")).migrateCommand,
    migrateFields: async () => (await import("./commands/migrate-fields.js")).migrateFieldsCommand,
    migrateViewLinks: async () => (await import("./commands/migrate-view-links.js")).migrateViewLinksCommand,
    mv: async () => (await import("./commands/mv.js")).mvCommand,
    notify: async () => (await import("./commands/notify/command.js")).notifyCommand,
    pairing: async () => (await import("./commands/pairing.js")).pairingCommand,
    pdf: async () => (await import("./commands/pdf.js")).pdfCommand,
    plugins: async () => (await import("./commands/plugins.js")).pluginsCommand,
    procedure: async () => (await import("./commands/procedure.js")).procedureCommand,
    pub: async () => (await import("./commands/pub/command.js")).pubCommand,
    query: async () => (await import("./commands/query.js")).queryCommand,
    reactor: async () => (await import("./commands/reactor.js")).reactorCommand,
    refreshMaps: async () => (await import("./commands/refresh-maps.js")).refreshMapsCommand,
    relink: async () => (await import("./commands/relink.js")).relinkCommand,
    remind: async () => (await import("./commands/remind/command.js")).remindCommand,
    retro: async () => (await import("./commands/retro.js")).retroCommand,
    rm: async () => (await import("./commands/rm.js")).rmCommand,
    runSummary: async () => (await import("./commands/run-summary.js")).runSummaryCommand,
    scanImport: async () => (await import("./commands/scan-import.js")).scanImportCommand,
    scheduled: async () => (await import("./commands/scheduled.js")).scheduledCommand,
    scheduler: async () => (await import("./commands/scheduler/command.js")).schedulerCommand,
    search: async () => (await import("./commands/search.js")).searchCommand,
    secrets: async () => (await import("./commands/secrets/command.js")).secretsCommand,
    serve: async () => (await import("./commands/serve.js")).serveCommand,
    session: async () => (await import("./commands/session/command.js")).sessionCommand,
    status: async () => (await import("./commands/status.js")).statusCommand,
    tailscale: async () => (await import("./commands/tailscale.js")).tailscaleCommand,
    template: async () => (await import("./commands/template.js")).templateCommand,
    tick: async () => (await import("./commands/tick.js")).tickCommand,
    todoReview: async () => (await import("./commands/todo-review.js")).todoReviewCommand,
    todos: async () => (await import("./commands/todos.js")).todosCommand,
    triage: async () => (await import("./commands/triage/command.js")).triageCommand,
    trick: async () => (await import("./commands/trick.js")).trickCommand,
    upgrade: async () => (await import("./commands/upgrade.js")).upgradeCommand,
    upload: async () => (await import("./commands/upload.js")).uploadCommand,
    usage: async () => (await import("./commands/usage.js")).usageCommand,
    validate: async () => (await import("./commands/validate/command.js")).validateCommand,
    view: async () => (await import("./commands/view/command.js")).viewCommand,
    wakeup: async () => (await import("./commands/wakeup/command.js")).wakeupCommand,
  },
});
