/**
 * Manual full-stack harness: create a real activity instance, spawn a real
 * Claude subprocess via the default ClaudeChatSpawner, send one message,
 * and stream the assistant's response to stdout. Exits when the turn
 * completes.
 *
 * Not part of the automated test suite — requires Claude Code auth and
 * network access. Run it manually when you need to verify that the
 * activity → session-pool → ChatSession → Claude wiring works end-to-end
 * against the real thing.
 *
 * Usage:
 *   tsx test/manual/activity-chat-live.ts <boxRoot> <instanceName> [message]
 *
 * Example:
 *   tsx test/manual/activity-chat-live.ts ~/src/boxes/test1 haiku-demo "The moon is full tonight."
 *
 * The harness registers a minimal "echo-haiku" activity inline — no
 * built-in activity needs to exist. On each run it creates the instance
 * if missing (idempotent for subsequent runs, which resume the saved
 * session id and continue the conversation).
 */

import { once } from "node:events";
import { resolve as resolvePath } from "node:path";
import {
  Activity,
  ActivityChatSessionPool,
  ActivityInstance,
  ActivityMode,
  ActivityRegistry,
  ActivityInstanceExistsError,
} from "../../src/activities/index.js";

// ─── A minimal inline activity ──────────────────────────────────────────────

export class EchoHaikuMain extends ActivityMode {
  readonly isDefault = true;
  systemPrompt() {
    return [
      "You are a haiku bot. Every user message gets exactly one reply:",
      "a 5-7-5 haiku inspired by the user's message. No preamble, no",
      "closing line — just the haiku, three lines, then stop.",
    ].join("\n");
  }
  available() {
    return true;
  }
}

export class EchoHaiku extends Activity {
  readonly type = "echo-haiku";
  readonly metadata = {
    title: "Echo Haiku",
    description: "Replies in haiku form. Manual-test harness only.",
    iconDescription: "Writing brush",
    singleton: false,
  };
  readonly modes = { main: EchoHaikuMain };

  async seedInstance(instance: ActivityInstance, ctx: { displayName: string }) {
    await instance.writeJson("state.json", {
      displayName: ctx.displayName,
      createdAt: new Date().toISOString(),
    });
    await instance.writeText(
      "CLAUDE.md",
      `# ${ctx.displayName}\n\nManual-test haiku echo instance.\n`,
    );
  }
}

// ─── Harness ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , boxRootArg, instanceNameArg, ...messageParts] = process.argv;

  if (!boxRootArg || !instanceNameArg) {
    console.error(
      "usage: tsx test/manual/activity-chat-live.ts <boxRoot> <instanceName> [message]",
    );
    process.exit(2);
  }

  const boxRoot = resolvePath(boxRootArg);
  const instanceName = instanceNameArg;
  const message = messageParts.length > 0
    ? messageParts.join(" ")
    : "The wind rustles the leaves outside my window.";

  console.error(`[harness] boxRoot=${boxRoot}`);
  console.error(`[harness] instance=echo-haiku/${instanceName}`);
  console.error(`[harness] message="${message}"`);

  const registry = new ActivityRegistry();
  registry.register(new EchoHaiku());

  const activity = registry.getOrThrow("echo-haiku");
  try {
    await activity.createInstance({
      boxRoot,
      name: instanceName,
      displayName: instanceName,
    });
    console.error(`[harness] created instance`);
  } catch (e) {
    if (e instanceof ActivityInstanceExistsError) {
      console.error(`[harness] instance already exists, reusing`);
    } else {
      throw e;
    }
  }

  const pool = new ActivityChatSessionPool(registry);
  const key = {
    boxRoot,
    activityType: "echo-haiku",
    instanceName,
    modeName: "main",
  };

  const session = await pool.getOrCreate(key);

  // Stream assistant text to stdout as it arrives.
  session.on("message", (msg: { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } }) => {
    if (msg.type === "assistant" && msg.message) {
      for (const block of msg.message.content ?? []) {
        if (block.type === "text" && block.text !== undefined) {
          process.stdout.write(block.text);
        }
      }
    }
  });

  session.on("close", (code: number | null) => {
    console.error(`\n[harness] subprocess closed with code=${code}`);
  });

  session.on("error", (err: Error) => {
    console.error(`\n[harness] session error: ${err.message}`);
  });

  console.error(`[harness] sending message...`);
  const done = once(session, "done");
  const accepted = await session.send(message);
  if (!accepted) {
    console.error(`[harness] send rejected (session busy?)`);
    process.exit(1);
  }

  const [result] = await done as [{ total_cost_usd?: number; duration_ms?: number; is_error?: boolean }];
  process.stdout.write("\n");
  console.error(`[harness] done: is_error=${result.is_error} duration=${result.duration_ms}ms cost=$${result.total_cost_usd}`);

  pool.closeAll();
  // Force-exit since readline and the event bus keep the loop alive briefly.
  process.exit(result.is_error ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
