// # bbx chat trigger arm, list, disarm
//
// `arm` imports the file in a child to get its label and tick, writes the
// activation for the agent's own chat (BBX_CHAT_SESSION_ID) with the default
// or given expiry, and refuses a bad file, config or expiry with one line.
// `list` shows the activations; `disarm` stops one by id or label, or all.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../../../helpers/test-helpers.js";
import { triggerCommand } from "../../../../../src/cli/commands/chat/trigger/command.js";
import { listActivations } from "../../../../../src/core/triggers/activation.js";

const WATER = `export const tick = 60;
export function label(config) { return "Water check (" + String(config.target) + ")"; }
export async function trigger() { return null; }
`;

void test("arm, list and disarm work on the agent's own chat and refuse what they cannot use.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("src/triggers/water.ts", WATER);
  await box.write("src/triggers/no-trigger.ts", "export function label() { return \"x\"; }\n");
  const cwd = process.cwd();
  process.chdir(box.root);
  t.teardown(() => { process.chdir(cwd); });
  const saved = process.env["BBX_CHAT_SESSION_ID"];
  process.env["BBX_CHAT_SESSION_ID"] = "session-1";
  t.teardown(() => {
    if (saved === undefined) delete process.env["BBX_CHAT_SESSION_ID"];
    else process.env["BBX_CHAT_SESSION_ID"] = saved;
  });
  const run = async (args: string[]): Promise<{ out: string[]; err: string[]; code: number | undefined }> => {
    const out: string[] = [];
    const err: string[] = [];
    const log = console.log;
    const error = console.error;
    process.exitCode = undefined;
    console.log = (line: string) => { out.push(line); };
    console.error = (line: string) => { err.push(line); };
    try {
      await triggerCommand.parseAsync(args, { from: "user" });
    } finally {
      console.log = log;
      console.error = error;
    }
    const code = process.exitCode === undefined ? undefined : Number(process.exitCode);
    process.exitCode = undefined;
    return { out, err, code };
  };
  const who = { boxRoot: box.root, sessionId: "session-1" };

  t.check(await run(["list"]), { out: ["No triggers armed in this chat."], err: [], code: undefined });
  t.check(await run(["arm", "src/triggers/water.ts", "--config", "{\"target\":\"H2O\"}"]), {
    out: [any(String).startsWith("Armed \"Water check (H2O)\" (").endsWith("from src/triggers/water.ts: on activity and every 60 s while someone is present; expires after 20 turns or 2 hours. The person sees \"Watching: Water check (H2O)\".")],
    err: [],
    code: undefined,
  });
  t.check(await run(["arm", "src/triggers/water.ts", "--config", "{\"target\":\"NH3\"}", "--expires", "never"]), { out: [any(String).includes("expires after never")], err: [], code: undefined });

  // Refusals: a bad module, bad JSON, an empty expiry.
  t.check(await run(["arm", "src/triggers/no-trigger.ts"]), { out: [], err: ["bbx chat trigger: src/triggers/no-trigger.ts: the file exports no `trigger` function (export async function trigger(input, ctx): Promise<TriggerResult | null>)"], code: 1 });
  t.check(await run(["arm", "src/triggers/water.ts", "--config", "{nope"]), { out: [], err: [any(String).startsWith("bbx chat trigger: --config is not JSON: ")], code: 1 });
  t.check(await run(["arm", "src/triggers/water.ts", "--expires", "{}"]), { out: [], err: ["bbx chat trigger: --expires needs a positive `turns` or `minutes` limit ({\"turns\":20,\"minutes\":120}), or the word never"], code: 1 });

  const armed = await listActivations(who);
  t.check(armed.map((a) => [a.label, a.state, a.tick, a.expires]), [["Water check (H2O)", "armed", 60, { turns: 20, minutes: 120 }], ["Water check (NH3)", "armed", 60, "never"]]);
  const listed = await run(["list"]);
  t.check(listed.out.map((line) => line.replace(/^\w+ {2}/, "ID  ")), [
    "ID  armed            Water check (H2O)  (src/triggers/water.ts; expires 20 turns or 2 hours; turns 0; fires 0; tick 60s)",
    "ID  armed            Water check (NH3)  (src/triggers/water.ts; expires never; turns 0; fires 0; tick 60s)",
  ]);

  t.check(await run(["disarm"]), { out: [], err: ["bbx chat trigger: name an activation id or label, or pass --all"], code: 1 });
  t.check(await run(["disarm", "Nothing"]), { out: [], err: ["bbx chat trigger: no activation with id or label \"Nothing\"; `bbx chat trigger list` shows them"], code: 1 });
  t.check(await run(["disarm", "Water check (H2O)"]), { out: [any(String).startsWith("Disarmed \"Water check (H2O)\" (")], err: [], code: undefined });
  t.check(await run(["disarm", armed[1]?.id ?? ""]), { out: [any(String).startsWith("Disarmed \"Water check (NH3)\" (")], err: [], code: undefined });
  t.check(await run(["disarm", "--all"]), { out: ["Nothing to disarm: no armed activation matched."], err: [], code: undefined });
  t.check((await listActivations(who)).map((a) => a.state), ["disarmed", "disarmed"]);
});
