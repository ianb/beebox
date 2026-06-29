/**
 * cb push - Web Push utilities.
 *
 * `cb push test` fires one push through the real sender to whatever endpoints
 * are subscribed to this box — the manual "does my browser actually receive
 * it" check, independent of any trigger. With CB_PUSH_FAKE=1 it routes through
 * the fake service and just writes a `.callback-box/push-debug.log` line.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { sendPush } from "../../core/send-push.js";

const testCommand = new Command("test")
  .description("Send a test push to this box's subscribed endpoints")
  .option("-t, --text <text>", "Notification body", "Test push from cb")
  .option("-u, --url <url>", "Deep-link path opened on click", "/")
  .action(async (options: { text: string; url: string }) => {
    const boxRoot = await requireBoxRoot();
    const result = await sendPush(boxRoot, {
      payload: { title: "Callback Box", body: options.text, url: options.url },
    });
    console.log(
      `Push: ${result.sent} sent, ${result.pruned} pruned (gone), ${result.failed} failed.`,
    );
  });

export const pushCommand = new Command("push")
  .description("Web Push utilities")
  .addCommand(testCommand);
