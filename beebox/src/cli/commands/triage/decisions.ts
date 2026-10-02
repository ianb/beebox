/** Decision history, trial replay, and explicit mutation commands. */
import type { Command } from "commander";
import { z } from "zod";
import { requireBoxRoot } from "../../../lib/paths/core.js";
import { compileInstructionSnapshot, instructionSnapshotSchema } from "../../../core/triage/snapshot.js";
import { decisionReceiptSchema, listDecisionReceipts } from "../../../core/triage/decisions/storage.js";
import { applyDecision } from "../../../core/triage/decisions/apply.js";
import { confirmDecision, correctDecision } from "../../../core/triage/decisions/confirm.js";
import { replayDecisions } from "../../../core/triage/decisions/replay.js";
import { output, readJson, cliAction, withInheritedJson, type OutputOptions } from "./io.js";

const outcomeFilter = z.enum(["user-confirmed", "agent-asserted", "corrected", "unknown"]);
const positive = z.coerce.number().int().positive();

export function registerDecisionCommands(parent: Command, reporting: (command: Command) => Command): void {
  const reportOptions = (options: OutputOptions): OutputOptions => withInheritedJson(parent, options);
  reporting(parent.command("decisions").description("List applied receipts; silence and predictions are not confirmation")
    .option("--destination <ref>", "Filter by landmark")
    .option("--instruction <ref>", "Filter by instruction source")
    .option("--outcome <kind>", "user-confirmed, agent-asserted, corrected, or unknown"))
    .action((options: OutputOptions & { destination?: string; instruction?: string; outcome?: string }) => cliAction(async () => {
      const decisions = await listDecisionReceipts(await requireBoxRoot(), {
        ...(options.destination ? { destination: options.destination } : {}),
        ...(options.instruction ? { instructionRef: options.instruction } : {}),
        ...(options.outcome ? { outcome: outcomeFilter.parse(options.outcome) } : {}),
      });
      await output(decisions, { ...reportOptions(options), summary: `${decisions.length} receipt(s).\n${decisions.map((d) => `${d.id}\t${d.judgment.outcome}\t${d.application.state}`).join("\n")}` });
    }));

  reporting(parent.command("replay [decision-ids...]").description("Fresh trial; never applies or researches. Missing cases are errors, not passes")
    .requiredOption("--instructions <file|current>", "Candidate snapshot or current canonical policy")
    .requiredOption("--max-calls <count>", "All-or-none cap including comparison/repeats")
    .option("--cases <file>", "JSON list of receipt IDs")
    .option("--compare <baseline>", "original runs a fresh original-instruction baseline")
    .option("--repeat <count>", "Repeat each case", "1")
    .option("--prepare-again", "Re-extract verified original bytes; reports preparation changes")
    .option("--model <model>", "Explicit override; reports model drift"))
    .action((ids: string[], options: OutputOptions & { instructions: string; maxCalls: string; cases?: string; compare?: string; repeat: string; prepareAgain?: boolean; model?: string }) => cliAction(async () => {
      const boxRoot = await requireBoxRoot();
      if (options.compare !== undefined) z.literal("original").parse(options.compare);
      const selected = [...ids, ...(options.cases ? await readJson(options.cases, z.array(z.uuid())) : [])];
      const repeat = positive.parse(options.repeat);
      const maxCalls = positive.parse(options.maxCalls);
      const instructions = options.instructions === "current" ? await compileInstructionSnapshot(boxRoot) : await readJson(options.instructions, instructionSnapshotSchema);
      console.error(`Replay plans ${selected.length * repeat * (options.compare ? 2 : 1)} Jev call(s); limit ${maxCalls}.`);
      const replay = await replayDecisions({ boxRoot, ids: selected, instructions, repeat, maxCalls, compareOriginal: options.compare === "original", prepareAgain: options.prepareAgain === true, ...(options.model ? { model: options.model } : {}) });
      await output(replay, { ...reportOptions(options), summary: `Replay: ${replay.results.length} result(s). Use --json to inspect transitions, errors and coverage.` });
    }));

  reporting(parent.command("apply <decision>").description("Apply a preview JSON file or resume a stored receipt ID"))
    .action((input: string, options: OutputOptions) => cliAction(async () => {
      const decision = z.uuid().safeParse(input).success ? input : await readJson(input, decisionReceiptSchema);
      const receipt = await applyDecision({ boxRoot: await requireBoxRoot(), decision });
      await output(receipt, { ...reportOptions(options), summary: `${receipt.id}: ${receipt.application.state} → ${receipt.application.to}` });
    }));

  reporting(parent.command("confirm <decision-id>").description("Append a sourced outcome assertion, never infer correctness from silence")
    .requiredOption("--source <ref>", "Answered question or actual user chat turn")
    .requiredOption("--outcome <ref>", "Confirmed destination landmark")
    .option("--user-turn <ref>", "User-authored chat turn proving a CLI answer"))
    .action((id: string, options: OutputOptions & { source: string; outcome: string; userTurn?: string }) => cliAction(async () => {
      const receipt = await confirmDecision({ boxRoot: await requireBoxRoot(), id, sourceRef: options.source, label: options.outcome, ...(options.userTurn ? { userTurnRef: options.userTurn } : {}) });
      await output(receipt, { ...reportOptions(options), summary: `${receipt.id}: outcome assertion recorded.` });
    }));

  reporting(parent.command("correct <decision-id>").description("Apply a held question's selected destination and preserve correction provenance")
    .requiredOption("--question <ref>", "Answered triage question")
    .option("--user-turn <ref>", "User-authored chat turn proving a CLI answer"))
    .action((id: string, options: OutputOptions & { question: string; userTurn?: string }) => cliAction(async () => {
      const receipt = await correctDecision({ boxRoot: await requireBoxRoot(), id, questionRef: options.question, ...(options.userTurn ? { userTurnRef: options.userTurn } : {}) });
      await output(receipt, { ...reportOptions(options), summary: `${receipt.id}: corrected → ${receipt.application.to}` });
    }));
}
