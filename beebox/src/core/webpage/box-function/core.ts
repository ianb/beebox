/**
 * A box's own `webpage.ts`: one function that can refuse a page or make its
 * card's content, by itself or through `standard`
 * (docs/plans/webpage-capture-tools.md).
 *
 * It is box code, so it runs as tricks do: its own process, the box's script
 * environment, from the tricks directory so its own imports resolve. A hang or
 * a crash cannot take the command with it. When it fails, nothing is saved:
 * running `standard` instead could save the page one of its rules refuses.
 *
 * The runner talks over IPC so that `standard(response)` inside the function
 * runs here on whatever response it is given. tsx loads through `--import`,
 * because its CLI puts a process between the two ends of the channel.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { boxCodePaths, getBoxShape } from "../../../lib/box-shape.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { buildScriptEnv } from "../../script-env/core.js";
import { CAPTURED_RESPONSE, WEBPAGE_RESULT, type CapturedResponse, type WebpageResult } from "../response.js";
import { standard } from "./standard.js";

const require = createRequire(import.meta.url);

const BOX_FUNCTION_TIMEOUT_MS = 60_000;

/** The box function's name under the tricks directory. */
const BOX_FUNCTION_FILE = "webpage.ts";

const RUNNER = `
const entry = process.env.BBX_WEBPAGE_FUNCTION;
const pending = new Map();
let nextId = 0;
const standard = (response) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  process.send({ type: "standard", id, response });
});
process.on("message", async (message) => {
  if (message.type === "standard-result") {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error));
    else call.resolve(message.result);
    return;
  }
  try {
    const { default: fn } = await import(entry);
    if (typeof fn !== "function") throw new Error("its default export is not a function");
    process.send({ type: "result", result: await fn(message.response, { standard }) }, () => process.exit(0));
  } catch (e) {
    process.send({ type: "error", error: e instanceof Error ? e.message : String(e) }, () => process.exit(0));
  }
});
`;

const CHILD_MESSAGE = z.discriminatedUnion("type", [
  z.object({ type: z.literal("standard"), id: z.number(), response: z.unknown() }),
  z.object({ type: z.literal("result"), result: z.unknown() }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);

export type WebpageOutcome =
  | { ok: true; result: WebpageResult; usedBoxFunction: boolean }
  | { ok: false; message: string };

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
}

function answerStandard(payload: unknown): { result: WebpageResult } | { error: string } {
  const parsed = CAPTURED_RESPONSE.safeParse(payload);
  if (!parsed.success) return { error: `standard was given a bad response: ${z.prettifyError(parsed.error)}` };
  try {
    return { result: standard(parsed.data) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function runBoxFunction(input: { boxRoot: string; tricksDir: string; entry: string; response: CapturedResponse }): Promise<WebpageOutcome> {
  const { boxRoot, tricksDir, entry, response } = input;
  const env = await buildScriptEnv(boxRoot, { BBX_BOX_ROOT: boxRoot, BBX_WEBPAGE_FUNCTION: pathToFileURL(entry).href });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", pathToFileURL(require.resolve("tsx/esm")).href, "--input-type=module", "--eval", RUNNER], {
      cwd: tricksDir,
      env,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 4000) stderr += chunk;
    });
    let settled = false;
    const finish = (outcome: WebpageOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(outcome);
    };
    const failed = (why: string): void => finish({ ok: false, message: `${BOX_FUNCTION_FILE} failed, so nothing was saved: ${why}` });
    const timer = setTimeout(() => failed(`it did not finish within ${String(BOX_FUNCTION_TIMEOUT_MS / 1000)} s`), BOX_FUNCTION_TIMEOUT_MS);
    child.on("message", (raw) => {
      const message = CHILD_MESSAGE.safeParse(raw);
      if (!message.success) {
        failed("it sent an unknown message");
        return;
      }
      switch (message.data.type) {
        case "standard":
          child.send({ type: "standard-result", id: message.data.id, ...answerStandard(message.data.response) });
          return;
        case "error":
          failed(message.data.error);
          return;
        case "result": {
          const result = WEBPAGE_RESULT.safeParse(message.data.result);
          if (result.success) finish({ ok: true, result: result.data, usedBoxFunction: true });
          else failed(`it returned the wrong shape; give { title, markdown } or { refuse }: ${z.prettifyError(result.error)}`);
          return;
        }
      }
    });
    child.once("error", (e) => failed(e.message));
    child.once("exit", (code) => failed(`it exited (code ${String(code)}) with no result${stderr === "" ? "" : `: ${stderr.trim()}`}`));
    child.send({ type: "response", response });
  });
}

/** Turn `response` into a result: through the box's function when it has one, otherwise `standard`. */
export async function runWebpageFunction({ boxRoot, response }: { boxRoot: string; response: CapturedResponse }): Promise<WebpageOutcome> {
  const { tricksDir } = boxCodePaths(await getBoxShape(boxRoot));
  const entry = path.join(tricksDir, BOX_FUNCTION_FILE);
  if (await exists(entry)) return runBoxFunction({ boxRoot, tricksDir, entry, response });
  return { ok: true, result: standard(response), usedBoxFunction: false };
}
