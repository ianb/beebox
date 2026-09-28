/** Small public operations; automatic triage composes these same core functions. */
import { Command } from "commander";
import { z } from "zod";
import { requireBoxRoot } from "../../../lib/paths/core.js";
import { runCommand, createCliContext } from "../../../core/command-runner.js";
import { prepareItem, evidenceSchema } from "../../../core/triage/evidence.js";
import { compileInstructionSnapshot, instructionSnapshotSchema } from "../../../core/triage/snapshot.js";
import { judgeItem } from "../../../core/triage/judge.js";
import { createDecisionReceipt } from "../../../core/triage/decisions/storage.js";
import { output, readJson, cliAction, withInheritedJson, type OutputOptions } from "./io.js";
import { registerDecisionCommands } from "./decisions.js";

function reporting(command: Command): Command {
  return command.option("--out <file>", "Write versioned JSON to a new caller-owned file")
    .option("--overwrite", "Allow replacing the explicit output file")
    .option("--json", "Print complete JSON, including prepared content where present");
}

export function createTriageCommand(): Command {
  const triageCommand = new Command("triage")
    .enablePositionalOptions()
    .description("Route admitted documents; prepare, judge and replay are inspectable trials.")
    .addHelpText("after", "\nApplied decisions retain prepared content in Git-backed receipts until explicitly deleted. Deleting the source alone does not erase replay evidence or Git history. Gmail admission is separate.")
    .option("--engine <engine>", "agent (default) or jev", "agent")
    .option("--dry-run", "Stop after classification; Jev mode never launches research")
    .option("--json", "Print the structured run result")
    .hook("preAction", (parent, actionCommand) => {
      if (parent === actionCommand) return;
      for (const [key, flag] of [["dryRun", "--dry-run"], ["engine", "--engine"]] as const) {
        if (parent.getOptionValueSource(key) === "cli") {
          actionCommand.error(`${flag} applies to automatic triage only, not triage ${actionCommand.name()}`, { exitCode: 1 });
        }
      }
    })
    .action((options: {engine: string; dryRun?: boolean; json?: boolean}) => cliAction(async () => {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);
      if (options.json) ctx.writeLine = () => {};
      const result = await runCommand({ name: "triage", args: { engine: options.engine, dryRun: options.dryRun === true }, ctx });
      if (!result.success) {
        if (options.json && result.data !== undefined) console.log(JSON.stringify(result.data, null, 2));
        else console.error(result.error);
        process.exitCode = 1;
      }
      else if (options.json) console.log(JSON.stringify(result.data, null, 2));
    }));

  reporting(triageCommand.command("prepare <source-ref>").description("Prepare complete admitted evidence without modifying sources"))
    .action((sourceRef: string, options: OutputOptions) => cliAction(async () => {
    const evidence = await prepareItem({ boxRoot: await requireBoxRoot(), sourceRef });
    await output(evidence, { ...withInheritedJson(triageCommand, options), summary: `Evidence ${evidence.status}: ${evidence.parts.length} part(s), ${evidence.parts.reduce((n, p) => n + p.omissions.length, 0)} omission(s).` });
    }));

  reporting(triageCommand.command("instructions").description("Compile the intake guide and landmark destination rules")
    .option("--overlay <file>", "Trial guide, including explicit hypotheses")
    .option("--landmarks <file>", "JSON map of canonical landmark refs to trial files"))
    .action((options: OutputOptions & {overlay?: string; landmarks?: string}) => cliAction(async () => {
    const instructions = await compileInstructionSnapshot(await requireBoxRoot(), {
      ...(options.overlay === undefined ? {} : { guideOverlay: options.overlay }),
      ...(options.landmarks === undefined ? {} : { landmarkOverlays: await readJson(options.landmarks, z.record(z.string(), z.string())) }),
    });
    await output(instructions, { ...withInheritedJson(triageCommand, options), summary: `${instructions.trial ? "Trial" : "Canonical"} instructions: ${instructions.destinations.length} destination(s), ${instructions.sources.length} source(s).` });
    }));

  reporting(triageCommand.command("judge").description("One Jev call; no research, question or file moves")
    .requiredOption("--evidence <file>", "Prepared evidence JSON")
    .requiredOption("--instructions <file>", "Instruction snapshot JSON")
    .option("--model <model>", "Explicit Jev model override"))
    .action((options: OutputOptions & {evidence: string; instructions: string; model?: string}) => cliAction(async () => {
    const boxRoot = await requireBoxRoot();
    const evidence = await readJson(options.evidence, evidenceSchema);
    const instructions = await readJson(options.instructions, instructionSnapshotSchema);
    const judgment = await judgeItem(boxRoot, { evidence, instructions, ...(options.model ? { model: options.model } : {}) });
    const decision = createDecisionReceipt({ boxRoot, evidence, instructions, judgment });
    await output(decision, { ...withInheritedJson(triageCommand, options), summary: `${decision.id}: ${judgment.outcome} ${judgment.destinationRef ?? ""}. ${judgment.reason.text}` });
    }));

  registerDecisionCommands(triageCommand, reporting);
  return triageCommand;
}

export const triageCommand = createTriageCommand();
