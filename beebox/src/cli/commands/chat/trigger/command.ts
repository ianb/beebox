/**
 * `bbx chat trigger`: arm, list, disarm, dry-run and read the trace of
 * activity triggers for your own chat session (plan:activity-triggers,
 * Track D). `eval-one` is the internal child the server and `run` spawn.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../../../lib/paths/core.js";
import { errorMessage } from "../../../../shared/error-guards.js";
import {
  armActivation,
  DEFAULT_EXPIRES,
  describeExpires,
  disarmActivations,
  expiresSchema,
  listActivations,
  readActivationFile,
  type Activation,
  type Expires,
} from "../../../../core/triggers/activation.js";
import { emitTriggerChanged } from "../../../../core/triggers/events.js";
import { inspectTrigger } from "../../../../core/triggers/eval.js";
import { logCommand } from "./log.js";
import { runCommand } from "./run.js";
import { parseConfig, requireSession, runCli, TriggerUsageError } from "./shared.js";

function parseExpires(raw: string | undefined): Expires {
  if (raw === undefined) return DEFAULT_EXPIRES;
  if (raw.trim() === "never") return "never";
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new TriggerUsageError({ detail: `--expires is neither "never" nor JSON: ${errorMessage(e)}` });
  }
  const parsed = expiresSchema.safeParse(json);
  if (!parsed.success) throw new TriggerUsageError({ detail: "--expires needs a positive `turns` or `minutes` limit ({\"turns\":20,\"minutes\":120}), or the word never" });
  return parsed.data;
}

/** One line per activation: `id  state  label  (expires …)  [error]`. */
function renderActivationLine(a: Activation): string {
  const parts = [a.id, a.state.padEnd(15), a.label, `(${a.file}; expires ${describeExpires(a.expires)}; turns ${String(a.turnsSeen)}; fires ${String(a.fires)}${a.tick === undefined ? "" : `; tick ${String(a.tick)}s`})`];
  if (a.error !== undefined) parts.push(`— ${a.error}`);
  return parts.join("  ");
}

const armCommand = new Command("arm")
  .description("Arm a trigger file for this chat: it is evaluated when the person acts in a view or figure, and on its tick")
  .argument("<file>", "The trigger file, box-relative (src/triggers/<name>.ts)")
  .option("--config <json>", "The config `label(config)` and `ctx.config` receive (default null)")
  .option("--expires <json|never>", "{\"turns\":N,\"minutes\":M} with at least one limit, or never (default 20 turns or 2 hours)")
  .action((file: string, options: { config?: string; expires?: string }) => runCli(async () => {
    const sessionId = await requireSession();
    const boxRoot = await requireBoxRoot();
    const config = parseConfig(options.config);
    const expires = parseExpires(options.expires);
    const inspected = await inspectTrigger({ boxRoot, file, config });
    if ("error" in inspected) throw new TriggerUsageError({ detail: inspected.error });
    const activation = await armActivation(boxRoot, { sessionId, file, config, label: inspected.label, tick: inspected.tick, expires });
    emitTriggerChanged(boxRoot, sessionId);
    const tick = activation.tick === undefined ? "on activity only" : `on activity and every ${String(activation.tick)} s while someone is present`;
    console.log(`Armed "${activation.label}" (${activation.id}) from ${file}: ${tick}; expires after ${describeExpires(activation.expires)}. The person sees "Watching: ${activation.label}".`);
  }));

const listCommand = new Command("list")
  .description("This chat's trigger activations and their states")
  .option("--json", "Print the activations as JSON")
  .action((options: { json?: boolean }) => runCli(async () => {
    const sessionId = await requireSession();
    const boxRoot = await requireBoxRoot();
    const who = { boxRoot, sessionId };
    const read = await readActivationFile(who);
    if (read.invalid) throw new TriggerUsageError({ detail: `the activation file .beebox/triggers/${sessionId}.json is invalid; fix or remove it` });
    const activations = await listActivations(who);
    if (options.json === true) {
      console.log(JSON.stringify(activations, null, 2));
      return;
    }
    if (activations.length === 0) {
      console.log("No triggers armed in this chat.");
      return;
    }
    for (const a of activations) console.log(renderActivationLine(a));
  }));

const disarmCommand = new Command("disarm")
  .description("Stop a trigger: by id, by label, or --all. The status line goes at once; an evaluation already running is discarded")
  .argument("[which]", "An activation id or label")
  .option("--all", "Disarm every activation in this chat")
  .action((which: string | undefined, options: { all?: boolean }) => runCli(async () => {
    const sessionId = await requireSession();
    const boxRoot = await requireBoxRoot();
    if (which === undefined && options.all !== true) throw new TriggerUsageError({ detail: "name an activation id or label, or pass --all" });
    const who = { boxRoot, sessionId };
    const activations = await listActivations(who);
    const selector = options.all === true ? { all: true as const } : activations.some((a) => a.id === which) ? { id: which ?? "" } : { label: which ?? "" };
    const changed = await disarmActivations(who, selector);
    if (changed.length === 0) {
      if (options.all === true || activations.some((a) => a.id === which || a.label === which)) console.log("Nothing to disarm: no armed activation matched.");
      else throw new TriggerUsageError({ detail: `no activation with id or label ${JSON.stringify(which)}; \`bbx chat trigger list\` shows them` });
      return;
    }
    emitTriggerChanged(boxRoot, sessionId);
    for (const a of changed) console.log(`Disarmed "${a.label}" (${a.id}).`);
  }));

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
  .addCommand(armCommand)
  .addCommand(listCommand)
  .addCommand(disarmCommand)
  .addCommand(runCommand)
  .addCommand(logCommand)
  .addCommand(evalOneCommand, { hidden: true });
