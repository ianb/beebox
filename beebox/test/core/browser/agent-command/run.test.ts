// One agent command on the box browser: the pass goes in once per host, and a
// `cookies` command (which may clear it) makes the next command install it again.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { ExecReply } from "../../../../src/core/browser/command-socket.js";
import { runAgentCommand } from "../../../../src/core/browser/agent-command/run.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

void test("cookies clear makes the next command install the pass again", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const sent: string[] = [];
  const reply = (args: readonly string[]): Promise<ExecReply> => {
    sent.push(args.slice(0, 2).join(" "));
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  };
  const ctx = { host: {}, boxRoot: box.root, slug: "test1", send: reply, sendFull: reply, env: { BBX_DEV_APP_URL: "http://localhost:3210/wt" }, now: Date.now() };
  await runAgentCommand(ctx, ["get", "url"]);
  await runAgentCommand(ctx, ["cookies", "clear"]);
  await runAgentCommand(ctx, ["get", "url"]);
  await runAgentCommand(ctx, ["get", "title"]);
  t.check(sent, ["cookies set", "get url", "cookies clear", "cookies set", "get url", "get title"]);
});
