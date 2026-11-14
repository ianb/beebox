/**
 * `bbx chat trigger`: arm, list, disarm, dry-run and read the trace of
 * activity triggers for your own chat session (docs/plans/activity-triggers.md).
 * `eval-one` is the internal child the server and `run` spawn.
 */

import { Command } from "commander";

const evalOneCommand = new Command("eval-one")
  .description("Internal: evaluate one trigger job read from stdin, for the server's runner and `trigger run`")
  .option("--inspect", "Only import the module and print its label and tick")
  .action(async (options: { inspect?: boolean }) => {
    const { readStdinJson, runEvalChild, runInspectChild } = await import("../../../../core/triggers/eval-child/core.js");
    const job = readStdinJson();
    if (options.inspect === true) await runInspectChild(job);
    else await runEvalChild(job);
    await (await import("esbuild")).stop();
  });

export const triggerCommand = new Command("trigger")
  .description("Activity triggers: functions in the box that watch what the person does and respond in this chat")
  .addCommand(evalOneCommand, { hidden: true });
