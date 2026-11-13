// # bbx chat activity
//
// Lists the window for the agent's own chat session (BBX_CHAT_SESSION_ID),
// oldest first: `HH:MM:SS  card  kind  detail  {activity json}`. Entries that
// arrived after the turn's message are marked; `--json` prints the raw lines.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { activityCommand, renderActivityText } from "../../../../src/cli/commands/chat/activity.js";
import { advanceForSend } from "../../../../src/core/activity/cursor.js";
import { recordActivity } from "../../../../src/core/activity/log.js";

const NOT_LINKED = "No activity found for this chat. If this is a new chat's first reply, its activity may not be linked yet: run the command again in a moment.";

void test("The command lists this session's window and marks entries after the message.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const cwd = process.cwd();
  process.chdir(box.root);
  t.teardown(() => { process.chdir(cwd); });
  const saved = process.env["BBX_CHAT_SESSION_ID"];
  process.env["BBX_CHAT_SESSION_ID"] = "s1";
  t.teardown(() => {
    if (saved === undefined) delete process.env["BBX_CHAT_SESSION_ID"];
    else process.env["BBX_CHAT_SESSION_ID"] = saved;
  });
  const run = async (args: string[]): Promise<string[]> => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => { lines.push(line); };
    try {
      await activityCommand.parseAsync(args, { from: "user" });
    } finally {
      console.log = log;
    }
    return lines.flatMap((line) => line.split("\n")).map((line) => line.replace(/^\d\d:\d\d:\d\d/, "HH:MM:SS"));
  };

  // No cursor yet: the session has had no person's send this feature saw, or its binding has not landed.
  t.check(await run([]), [NOT_LINKED]);
  await recordActivity(box.root, { user: null, entries: [
    { card: "Lab.figure.card", kind: "explored", detail: "add C", activity: { molecules: ["C"] }, chat: "s1" },
    { card: "Notes.view.card", kind: "scrolled", detail: "Moles and mass", chat: "s1" },
    { card: "Lab.figure.card", kind: "explored", detail: "other chat", chat: "s2" },
  ] });
  await advanceForSend(box.root, { sessionId: "s1" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await recordActivity(box.root, { user: null, entries: [{ card: "Lab.figure.card", kind: "explored", detail: "remove H", chat: "s1" }] });

  t.check(await run([]), [
    "HH:MM:SS  Lab.figure.card  explored  add C  {\"molecules\":[\"C\"]}",
    "HH:MM:SS  Notes.view.card  scrolled  Moles and mass",
    "HH:MM:SS  Lab.figure.card  explored  remove H  (after your message)",
  ]);
  t.check(await run(["--card", "Notes.view.card"]), ["HH:MM:SS  Notes.view.card  scrolled  Moles and mass"]);
  t.check((await run(["--json"])).map((line) => String(JSON.parse(line).detail)), ["add C", "Moles and mass", "remove H"]);
});

void test("An empty window prints the empty message.", (t) => {
  t.check(renderActivityText([], { hinted: 3 }), "No activity since your last reply.");
  t.check(renderActivityText([], { hinted: undefined }), NOT_LINKED);
  t.end();
});

// One batch shares a server time; the page's time keeps two edits apart. A
// malformed page time falls back to the server's.
void test("Each line shows the page's time for the action, or the server's when the page time is unreadable.", (t) => {
  const base = { card: "Lab.figure.card", kind: "explored" as const, seq: 1, user: null };
  const at = "2026-11-13T09:13:30.000Z";
  const local = (iso: string): string => {
    const d = new Date(iso);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  };
  const text = renderActivityText([
    { ...base, at, clientAt: "2026-11-13T09:13:21.000Z", detail: "set answer = " },
    { ...base, at, seq: 2, clientAt: "2026-11-13T09:13:29.000Z", detail: "set answer = 16" },
    { ...base, at, seq: 3, clientAt: "not a time", detail: "pressed tile-H" },
  ], { hinted: 99 }).split("\n").map((line) => line.slice(0, 8));
  t.check(text, [local("2026-11-13T09:13:21.000Z"), local("2026-11-13T09:13:29.000Z"), local(at)]);
  t.end();
});
