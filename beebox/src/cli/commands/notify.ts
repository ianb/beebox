/**
 * bbx notify — reach the boxholder from an agent or a script.
 *
 * A thin layer over `notifyBoxholder`: parse the flags, read the body (flag,
 * file, or piped stdin, because a composed body does not belong on a command
 * line), send, and report each channel's delivery. `--check` reports which
 * channels can reach the person without sending, so an agent can check before
 * promising a reminder. See docs/plans/notifications.md (Track A).
 *
 * Exit codes: 0 when the notification reached the person (a channel sent it,
 * or it was held back because the person is in the app, which shows it); 1
 * when it reached nobody (every tried channel failed, or none could be tried),
 * or `--check` finds no channel; 2 on a bad flag or target.
 */

import * as fs from "node:fs/promises";
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { errorMessage } from "../../lib/error-guards.js";
import { notifyBoxholder, notifyChannels, type NotifyResult, type NotifyServices } from "../../core/notify-boxholder.js";
import { CHANNELS, LOUDNESS, type ChannelName, type Delivery, type Loudness } from "../../core/notification/intent.js";
import { InvalidTargetError, parseTarget, type Target } from "../../core/notification/target.js";
import { err, ok, type Result } from "../../lib/result.js";
import { resolveChatSessionId } from "../../core/chat/session/session-id-file.js";

export interface NotifyCliOptions {
  body?: string | undefined;
  bodyFile?: string | undefined;
  target?: string | undefined;
  loudness?: string | undefined;
  tag?: string | undefined;
  channel?: string | undefined;
  check?: boolean | undefined;
  targetsFromStdin?: boolean | undefined;
}

export interface NotifyRun {
  title: string | undefined;
  options: NotifyCliOptions;
  /** Piped stdin, or null when stdin is a terminal. Read lazily: only when the flags call for it. */
  readStdin: (() => Promise<string>) | null;
  /** Which code or chat session wrote it. */
  source: string;
  services?: NotifyServices | undefined;
}

/** A usage error message (exit 2), or the parsed value. */
type Parsed<T> = Result<T>;

function pick<T extends string>(opts: { value: string | undefined; allowed: readonly T[]; flag: string }): Parsed<T | undefined> {
  const { value, allowed, flag } = opts;
  if (value === undefined) return { ok: true, value };
  const found = allowed.find((a) => a === value);
  return found === undefined ? err(`${flag} must be one of ${allowed.join(", ")} (got "${value}")`) : ok(found);
}

function target(value: string): Parsed<Target> {
  try {
    return ok(parseTarget(value.trim()));
  } catch (e) {
    if (e instanceof InvalidTargetError) return err(e.message);
    throw e;
  }
}

async function readBody(run: NotifyRun): Promise<Parsed<string>> {
  const { options } = run;
  if (options.body !== undefined && options.bodyFile !== undefined) return err("give --body or --body-file, not both");
  if (options.body !== undefined) return ok(options.body);
  if (options.bodyFile !== undefined) {
    try {
      return ok((await fs.readFile(options.bodyFile, "utf-8")).replace(/\r?\n$/, ""));
    } catch (e) {
      return err(`could not read --body-file ${options.bodyFile}: ${errorMessage(e)}`);
    }
  }
  if (options.targetsFromStdin === true || run.readStdin === null) return ok("");
  return ok((await run.readStdin()).replace(/\r?\n$/, ""));
}

async function readTargets(run: NotifyRun): Promise<Parsed<Target[]>> {
  const { options } = run;
  if (options.targetsFromStdin !== true) {
    if (options.target === undefined) return err("--target is required (or --targets-from-stdin)");
    const one = target(options.target);
    return one.ok ? ok([one.value]) : one;
  }
  if (options.target !== undefined) return err("give --target or --targets-from-stdin, not both");
  if (run.readStdin === null) return err("--targets-from-stdin needs targets piped on stdin, one per line");
  const lines = (await run.readStdin()).split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return err("--targets-from-stdin read no targets");
  const targets: Target[] = [];
  for (const line of lines) {
    const parsed = target(line);
    if (!parsed.ok) return parsed;
    targets.push(parsed.value);
  }
  return ok(targets);
}

interface NotifyRequestParsed {
  title: string;
  loudness: Loudness;
  channel: ChannelName | undefined;
  targets: Target[];
  body: string;
}

/** Every flag checked, and every target parsed, before anything is sent. */
async function parseRequest(run: NotifyRun): Promise<Parsed<NotifyRequestParsed>> {
  const { options } = run;
  const title = run.title?.trim() ?? "";
  if (title === "") return err("a title is required");
  const loudness = pick({ value: options.loudness, allowed: LOUDNESS, flag: "--loudness" });
  if (!loudness.ok) return loudness;
  const channel = pick({ value: options.channel, allowed: CHANNELS, flag: "--channel" });
  if (!channel.ok) return channel;
  const targets = await readTargets(run);
  if (!targets.ok) return targets;
  const body = await readBody(run);
  if (!body.ok) return body;
  return ok({ title, loudness: loudness.value ?? "quiet", channel: channel.value, targets: targets.value, body: body.value });
}

function describe(delivery: Delivery): string {
  return `${delivery.channel} ${delivery.status}${delivery.detail === undefined ? "" : ` (${delivery.detail})`}`;
}

/** Reached: a channel sent it, or the person is in the app, which shows it. */
function reached(result: NotifyResult): boolean {
  return result.deliveries.some((d) => d.status === "sent" || (d.status === "skipped" && d.detail === "present"));
}

async function check(boxRoot: string, services: NotifyServices | undefined): Promise<number> {
  const can = await notifyChannels(boxRoot, { services });
  const byChannel: Record<ChannelName, boolean> = { apns: can.apns, "web-push": can.webPush, telegram: can.telegram };
  for (const channel of CHANNELS) console.log(`${channel}: ${byChannel[channel] ? "yes" : "no"}`);
  return CHANNELS.some((channel) => byChannel[channel]) ? 0 : 1;
}

async function send(boxRoot: string, run: NotifyRun): Promise<number> {
  const parsed = await parseRequest(run);
  if (!parsed.ok) {
    console.error(`Error: ${parsed.error}`);
    return 2;
  }
  const { title, loudness, channel, targets, body } = parsed.value;
  let exitCode = 0;
  for (const t of targets) {
    const result = await notifyBoxholder(boxRoot, {
      intent: { title, body, target: t, loudness, tag: run.options.tag, source: run.source },
      services: run.services,
      channel,
    });
    const line = `${result.id}: ${result.deliveries.map(describe).join(", ") || "no channel tried"}`;
    if (reached(result)) {
      console.log(line);
    } else {
      console.error(`Not delivered: ${line}`);
      exitCode = 1;
    }
  }
  return exitCode;
}

/** The command's logic with `boxRoot` given, returning the exit code: the seam `test/cli/notify.doctest.md` drives. */
export async function runNotify(boxRoot: string, run: NotifyRun): Promise<number> {
  return run.options.check === true ? check(boxRoot, run.services) : send(boxRoot, run);
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

export const notifyCommand = new Command("notify")
  .description("Notify the boxholder: log it, show it in an open app, and send it on the channels its loudness calls for")
  .argument("[title]", "One-line title (required unless --check)")
  .option("--body <text>", "Body text (default: piped stdin, else empty)")
  .option("--body-file <path>", "Read the body from a file")
  .option("--target <target>", "Where a tap lands: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard")
  .option("--loudness <loudness>", "dot (badge only), quiet (no sound; held back while the person is in the app), or loud", "quiet")
  .option("--tag <tag>", "Collapse key: a later notification with the same tag replaces this one")
  .option("--channel <channel>", "Deliver on this channel only (apns, web-push, telegram); for testing")
  .option("--check", "Print which channels can reach the person and send nothing; exit 1 when none can")
  .option("--targets-from-stdin", "Read one target per line from stdin and send one notification each (body from --body or --body-file)")
  .action(async (title: string | undefined, options: NotifyCliOptions) => {
    try {
      const boxRoot = await requireBoxRoot();
      const chatSession = await resolveChatSessionId({ waitMs: 0 });
      const exitCode = await runNotify(boxRoot, {
        title,
        options,
        readStdin: process.stdin.isTTY === true ? null : readAllStdin,
        source: chatSession === null ? "bbx notify" : `chat:${chatSession}`,
      });
      process.exit(exitCode);
    } catch (e) {
      console.error(`Error: ${errorMessage(e)}`);
      process.exit(1);
    }
  });
