/**
 * Manual full-stack harness: drive a real Claude subprocess through the
 * activity chat stack for one turn.
 *
 * Not part of the automated test suite — requires Claude Code auth and
 * network access. Run it manually when you need to verify the
 * registry → session-pool → ChatSession → Claude wiring end-to-end,
 * including MCP tool invocation.
 *
 * Usage:
 *   tsx test/manual/activity-chat-live.ts <boxRoot> <activityType> <instanceName> [--mode=<mode>] <message...>
 *
 * Examples:
 *   # Run polyglot setup — agent should call the `configure` tool
 *   tsx test/manual/activity-chat-live.ts ~/src/boxes/test1 polyglot spanish-test \
 *     "I want to learn Spanish, I'm a beginner"
 *
 *   # Run polyglot main (requires setup to have completed — state.json.language set)
 *   tsx test/manual/activity-chat-live.ts ~/src/boxes/test1 polyglot spanish-test --mode=main \
 *     "Hola! How do I say 'good morning'?"
 *
 * The instance is created on first run if it doesn't exist. Subsequent
 * runs against the same instance reuse its state (and resume the saved
 * session id for the same mode, continuing the conversation).
 *
 * If `--mode` is omitted, the framework's default mode is used (per
 * `pickDefaultMode` — usually `setup` for a fresh instance, `main`
 * once configured).
 */

import { once } from "node:events";
import { resolve as resolvePath } from "node:path";
import {
  ActivityChatSessionPool,
  ActivityInstanceExistsError,
  createBuiltinRegistry,
  pickDefaultMode,
} from "../../src/activities/index.js";

function parseArgs(argv: string[]): {
  boxRoot: string;
  activityType: string;
  instanceName: string;
  mode: string | null;
  message: string;
} {
  const positional: string[] = [];
  let mode: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
    } else {
      positional.push(arg);
    }
  }
  const [boxRootArg, activityType, instanceName, ...messageParts] = positional;
  if (!boxRootArg || !activityType || !instanceName) {
    console.error(
      "usage: tsx test/manual/activity-chat-live.ts <boxRoot> <activityType> <instanceName> [--mode=<mode>] <message...>",
    );
    process.exit(2);
  }
  const message = messageParts.join(" ").trim();
  if (message === "") {
    console.error("error: no message supplied");
    process.exit(2);
  }
  return {
    boxRoot: resolvePath(boxRootArg),
    activityType,
    instanceName,
    mode,
    message,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.error(`[harness] boxRoot=${args.boxRoot}`);
  console.error(`[harness] activity=${args.activityType}/${args.instanceName}`);

  const registry = createBuiltinRegistry();
  const activity = registry.get(args.activityType);
  if (activity === undefined) {
    console.error(
      `error: unknown activity type '${args.activityType}'. ` +
        `Registered: ${registry.list().map((a) => a.type).join(", ") || "(none)"}`,
    );
    process.exit(2);
  }

  try {
    await activity.createInstance({
      boxRoot: args.boxRoot,
      name: args.instanceName,
      displayName: args.instanceName,
    });
    console.error(`[harness] created instance`);
  } catch (e) {
    if (e instanceof ActivityInstanceExistsError) {
      console.error(`[harness] instance already exists, reusing`);
    } else {
      throw e;
    }
  }

  // Pick mode: explicit arg wins, else the framework default for this state.
  const instance = activity.getInstance(activity.instanceRoot(args.boxRoot, args.instanceName));
  const modeName = args.mode ?? (await pickDefaultMode(activity, instance));
  if (modeName === null) {
    console.error(`error: no mode available for this instance`);
    process.exit(1);
  }
  console.error(`[harness] mode=${modeName}`);
  console.error(`[harness] message="${args.message}"`);

  const pool = new ActivityChatSessionPool(registry);
  const session = await pool.getOrCreate({
    boxRoot: args.boxRoot,
    activityType: args.activityType,
    instanceName: args.instanceName,
    modeName,
  });

  // Stream assistant text to stdout as it arrives.
  session.on("message", (msg: { type?: string; message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }> } }) => {
    if (msg.type === "assistant" && msg.message) {
      for (const block of msg.message.content ?? []) {
        if (block.type === "text" && block.text !== undefined) {
          process.stdout.write(block.text);
        } else if (block.type === "tool_use" && block.name !== undefined) {
          process.stderr.write(
            `\n[harness] tool_use: ${block.name}(${JSON.stringify(block.input)})\n`,
          );
        }
      }
    }
  });
  session.on("close", (code: number | null) => {
    console.error(`\n[harness] subprocess closed code=${code}`);
  });
  session.on("error", (err: Error) => {
    console.error(`\n[harness] session error: ${err.message}`);
  });

  console.error(`[harness] sending...`);
  const done = once(session, "done");
  const accepted = await session.send(args.message);
  if (!accepted) {
    console.error(`[harness] send rejected`);
    process.exit(1);
  }

  const [result] = (await done) as [{ total_cost_usd?: number; duration_ms?: number; is_error?: boolean }];
  process.stdout.write("\n");
  console.error(
    `[harness] done: is_error=${result.is_error} duration=${result.duration_ms}ms cost=$${result.total_cost_usd}`,
  );

  pool.closeAll();
  process.exit(result.is_error ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
