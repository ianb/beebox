#!/usr/bin/env node

/**
 * Callback Box CLI
 *
 * The CLI is the universal interface - humans, agents, and tests all use it.
 */

// MUST be first import - sets TSX_TSCONFIG_PATH before any JSX modules load
import "./bootstrap.js";

import { Command } from "commander";
import {
  initCommand,
  statusCommand,
  validateCommand,
  createCommand,
  contextCommand,
  serveCommand,
  answerCommand,
  syncCommand,
  trashCommand,
  moveCommand,
  fetchNewsCommand,
  fetchAllNewsCommand,
  processNewsCommand,
  processFeedbackCommand,
  triageFeedbackCommand,
  workflowCommand,
  initRulesCommand,
  pairCommand,
  executeCommandsCommand,
  transcribeCapturesCommand,
  assembleTimelineCommand,
  googleAuthCommand,
  calendarCommand,
  finishCommand,
  reactorCommand,
} from "./commands/index.js";

const program = new Command();

program
  .name("cb")
  .description("Callback Box - file-based processing system")
  .version("0.1.0");

// ============================================
// Implemented commands
// ============================================

program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(validateCommand);
program.addCommand(createCommand);
program.addCommand(contextCommand);
program.addCommand(serveCommand);
program.addCommand(answerCommand);
program.addCommand(syncCommand);
program.addCommand(trashCommand);
program.addCommand(moveCommand);
program.addCommand(fetchNewsCommand);
program.addCommand(fetchAllNewsCommand);
program.addCommand(processNewsCommand);
program.addCommand(processFeedbackCommand);
program.addCommand(triageFeedbackCommand);
program.addCommand(workflowCommand);
program.addCommand(initRulesCommand);
program.addCommand(pairCommand);
program.addCommand(executeCommandsCommand);
program.addCommand(transcribeCapturesCommand);
program.addCommand(assembleTimelineCommand);
program.addCommand(googleAuthCommand);
program.addCommand(calendarCommand);
program.addCommand(finishCommand);
program.addCommand(reactorCommand);

// ============================================
// Placeholder commands (to be implemented)
// ============================================

program
  .command("commit")
  .description("Commit changes with validation")
  .option("-m, --message <message>", "Commit message")
  .action((options: { message?: string }) => {
    console.log(`cb commit: would commit with message "${options.message ?? "(no message)"}"`);
    console.log("Not yet implemented");
  });


program
  .command("do")
  .description("Execute a specific command card")
  .argument("<card>", "Command card to execute")
  .option("--dry-run", "Preview without executing")
  .action((card: string, options: { dryRun?: boolean }) => {
    console.log(`cb do: would execute ${card}${options.dryRun ? " (dry run)" : ""}`);
    console.log("Not yet implemented");
  });

program
  .command("tail")
  .description("Run tailing phase (indexing, scheduling)")
  .action(() => {
    console.log("cb tail: would run tailing phase");
    console.log("Not yet implemented");
  });

program
  .command("scheduled")
  .description("Show scheduled tasks")
  .action(() => {
    console.log("cb scheduled: would show scheduled tasks");
    console.log("Not yet implemented");
  });

// ============================================
// Inspection commands
// ============================================

program
  .command("show")
  .description("Show a card's contents")
  .argument("<card>", "Card path to display")
  .option("--raw", "Show raw XML instead of pretty-printed")
  .action((card: string, options: { raw?: boolean }) => {
    console.log(`cb show: would display ${card}${options.raw ? " (raw)" : ""}`);
    console.log("Not yet implemented");
  });

program
  .command("log")
  .description("Show recent activity")
  .option("-n, --count <n>", "Number of entries to show", "10")
  .action((options: { count: string }) => {
    console.log(`cb log: would show ${options.count} recent entries`);
    console.log("Not yet implemented");
  });

program
  .command("diff")
  .description("Show changes since last commit or run")
  .option("--staged", "Show staged changes")
  .action((options: { staged?: boolean }) => {
    console.log(`cb diff: would show ${options.staged ? "staged " : ""}changes`);
    console.log("Not yet implemented");
  });

// ============================================
// Simulation/testing commands
// ============================================

program
  .command("inject")
  .description("Create a fake inbox item for testing")
  .argument("<type>", "Card type (email, memo, signal, etc.)")
  .option("--from <from>", "Sender/source")
  .option("--subject <subject>", "Subject line")
  .option("--body <body>", "Body content")
  .action((type: string, options: { from?: string; subject?: string; body?: string }) => {
    console.log(`cb inject: would create fake ${type}`);
    console.log(`  options: ${JSON.stringify(options)}`);
    console.log("Not yet implemented");
  });

program
  .command("step")
  .description("Run one processing cycle then stop")
  .option("--dry-run", "Show what would happen without doing it")
  .action((options: { dryRun?: boolean }) => {
    console.log(`cb step: would run one cycle${options.dryRun ? " (dry run)" : ""}`);
    console.log("Not yet implemented");
  });

program.parse();
