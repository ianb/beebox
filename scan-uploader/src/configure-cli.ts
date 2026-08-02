/**
 * argv parsing, stdin/TTY token + folder resolution, and process-facing
 * dispatch for the `configure` subcommand. Kept separate from `configure.ts`
 * so the core logic stays free of process globals and directly doctestable;
 * this file owns everything that touches `process.stdin`/`process.argv`.
 * The interactive (TTY) prompt paths aren't exercised by doctests — see the
 * comment on `promptToken` — but the non-TTY fail-closed path
 * (`requireFolderFlag`) and the argv/flag parsers are plain functions and
 * are covered directly.
 */

import { homedir } from "node:os";
import { createInterface } from "node:readline";

import type { Disposition } from "./config.js";
import { configure, type ConfigureResult } from "./configure.js";
import { errorMessage } from "./error-guards.js";
import { ConfigureError } from "./errors.js";

const DEFAULT_CONFIG_PATH = "./scan-uploader.json";
const DEFAULT_NAME = "uploader";
const DISPOSITIONS: readonly Disposition[] = ["keep", "archive", "trash"];

export function printConfigureHelp(): void {
  console.log(
    [
      "Usage: scan-uploader configure <server-url-with-box> --folder <path> [options]",
      "",
      "Writes (or updates) this machine's scan-uploader.json target and token",
      "file for one box, then verifies the token against the server.",
      "",
      "  <server-url-with-box>  e.g. https://cb.example.org/family",
      "  --folder <path>        folder to watch for scans (prompted if omitted on a TTY)",
      "  --disposition <value>  keep (default), archive, or trash",
      "  --name <token-name>    label shown in the confirmation message (default: uploader)",
      "  --config <path>        config file to write (default: ./scan-uploader.json)",
      "  -h, --help             show this help",
      "",
      "The token is read from stdin: pipe it, or leave stdin a TTY to be",
      "prompted for it without echo.",
    ].join("\n"),
  );
}

export interface ConfigureFlags {
  readonly serverUrlWithBox: string | undefined;
  readonly folder: string | undefined;
  readonly disposition: string | undefined;
  readonly name: string | undefined;
  readonly configPath: string | undefined;
}

export function parseConfigureArgs(args: readonly string[]): ConfigureFlags {
  let serverUrlWithBox: string | undefined;
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        const message = `--${flagName} requires a value`;
        throw new ConfigureError(message);
      }
      flags.set(flagName, value);
      i += 1;
      continue;
    }
    if (serverUrlWithBox === undefined) {
      serverUrlWithBox = arg;
    }
  }
  return {
    serverUrlWithBox,
    folder: flags.get("folder"),
    disposition: flags.get("disposition"),
    name: flags.get("name"),
    configPath: flags.get("config"),
  };
}

export function parseDisposition(value: string | undefined): Disposition {
  if (value === undefined) return "keep";
  if (!isDisposition(value)) {
    const message = `--disposition must be one of ${DISPOSITIONS.join(", ")} (got "${value}")`;
    throw new ConfigureError(message);
  }
  return value;
}

function isDisposition(value: string): value is Disposition {
  return value === "keep" || value === "archive" || value === "trash";
}

/** The non-TTY half of the folder-resolution rule: fails closed naming the
 * exact missing flag. The TTY half (interactive prompt) is `promptFolder`
 * below, reached only when stdin is a real TTY. */
export function requireFolderFlag(folder: string | undefined): string {
  if (folder === undefined) {
    const message = "missing required flag: --folder";
    throw new ConfigureError(message);
  }
  if (folder.length === 0) {
    const message = "--folder must not be empty";
    throw new ConfigureError(message);
  }
  return folder;
}

export async function runConfigureCommand(args: readonly string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printConfigureHelp();
    return 0;
  }
  try {
    const result = await runConfigure(args);
    printResult(result);
    return 0;
  } catch (e) {
    console.error(`scan-uploader configure: ${errorMessage(e)}`);
    return 1;
  }
}

async function runConfigure(args: readonly string[]): Promise<ConfigureResult> {
  const flags = parseConfigureArgs(args);
  if (flags.serverUrlWithBox === undefined) {
    const message = "missing required argument: <server-url-with-box>";
    throw new ConfigureError(message);
  }
  const isTTY = process.stdin.isTTY === true;
  const folder = flags.folder === undefined && isTTY ? await promptFolder() : requireFolderFlag(flags.folder);
  const disposition =
    flags.disposition === undefined && flags.folder === undefined && isTTY
      ? await promptDisposition()
      : parseDisposition(flags.disposition);
  const token = isTTY ? await promptToken() : await readPipedToken();
  return configure({
    serverUrlWithBox: flags.serverUrlWithBox,
    folder,
    disposition,
    name: flags.name ?? DEFAULT_NAME,
    token,
    configPath: flags.configPath ?? DEFAULT_CONFIG_PATH,
    homeDir: homedir(),
  });
}

function printResult(result: ConfigureResult): void {
  console.log(`configured: ${result.name} -> ${result.box} (server verified)`);
  console.log("");
  console.log("Next steps — set up one ScanSnap profile for this box:");
  console.log("  - Format: searchable PDF (ScanSnap's own OCR text layer)");
  console.log("  - Output: one PDF per scan job (don't batch unrelated documents)");
  console.log(`  - Destination folder: ${result.folder}`);
  console.log(
    "  - Post-scan hook: point the post-scan action at a wrapper running " +
      `"node /path/to/scan-uploader.mjs ${result.configPath}"`,
  );
  console.log(
    "  - Periodic sweep (safety net for scans that land while the hook " +
      'didn\'t run): on macOS, "scan-uploader schedule install" — see ' +
      "`scan-uploader schedule --help`",
  );
}

function promptVisible(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptFolder(): Promise<string> {
  const folder = await promptVisible("Folder to watch for scans: ");
  if (folder.length === 0) {
    const message = "a folder path is required";
    throw new ConfigureError(message);
  }
  return folder;
}

async function promptDisposition(): Promise<Disposition> {
  const answer = await promptVisible("Disposition [keep/archive/trash] (default keep): ");
  return parseDisposition(answer.length === 0 ? undefined : answer);
}

interface MutedReadline {
  _writeToOutput: (chunk: string) => void;
}

/** Reads the token without echoing it. Node's `readline` has no public API
 * for a no-echo prompt, so this overrides the internal `_writeToOutput`
 * writer — the standard documented recipe for this exact gap. Not exercised
 * by doctests: it needs a real TTY, and `readPipedToken` below covers the
 * same token-consumption logic that `configure()` actually depends on. */
async function promptToken(): Promise<string> {
  process.stdout.write("Paste the scan-upload token: ");
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // eslint-disable-next-line no-restricted-syntax -- readline exposes no public API to suppress input echo; overriding `_writeToOutput` is the standard Node.js recipe for a no-echo prompt.
    (rl as unknown as MutedReadline)._writeToOutput = () => {};
    let answered = false;
    // `question`'s callback never fires on EOF (e.g. Ctrl-D, or piped-empty
    // stdin misdetected as a TTY) — without this, the returned promise would
    // hang forever instead of failing closed.
    rl.on("close", () => {
      if (!answered) {
        const message = "no token was entered (stdin closed before a line was submitted)";
        reject(new ConfigureError(message));
      }
    });
    rl.question("", (answer) => {
      answered = true;
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function readPipedToken(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}
