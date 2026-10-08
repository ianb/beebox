/**
 * `bin/coding-feedback` — write and list CODING_FEEDBACK entries.
 *
 * At fixed checkpoints an agent records a short retrospective note: what was
 * slow, what guidance was wrong, what tracked change or codebase change would
 * have helped. Entries live outside git beside the workstream's exhibits and
 * are read only by a later retrospective scan. Entry format, paths, and the
 * prompts: `bin/lib/coding-feedback.ts`; session attachment:
 * `bin/lib/coding-feedback-session.ts`.
 *
 * The store directory is derived the way `bin/exhibits` derives it:
 * `<parent of main checkout>/workstream-exhibits/<workstream>/`, override
 * `BBX_EXHIBITS_ROOT`. Nothing is ever written into the checkout.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { execa } from "execa";

import {
  CHECKPOINTS, ENGINES, FEEDBACK_DIR, PROMPTS, entryFileName, formatEntry, formatListLine, isCheckpoint, isEngine, isIsoInstant,
  newestFirst, normalizeBody, parseEntry, type ListedEntry,
} from "./lib/coding-feedback.ts";
import {
  AllWithWorkstreamError, EmptyBodyError, InvalidCheckpointError, InvalidEngineError, InvalidSinceError, InvalidWorkstreamError, NoFreeEntryNameError,
  NotAnEntryError, ShowArgumentsError, StoreInsideCheckoutError, UnknownCommandError, UnmarkedStoreError, UsageError,
} from "./lib/coding-feedback-errors.ts";
import { resolveSession } from "./lib/coding-feedback-session.ts";

const USAGE = `usage: bin/coding-feedback <command>

  add --checkpoint ${CHECKPOINTS.join("|")}
      [--workstream <name>] [--engine claude|codex] [--session <id>]
      [--transcript <path>] [--file <path>]
                        Write one entry; the body comes from stdin or --file.
                        Prints the written path.
  list [--workstream <name> | --all] [--since <iso>] [--json]
                        Entries, newest first; --since keeps only entries
                        strictly after that ISO instant.
  show <path>           Print one entry.

The body answers four prompts:
${PROMPTS.map((p) => `  ${p}`).join("\n")}
`;

const STORE_MARKER = ".workstream-exhibits";
const NAME = /^[A-Za-z0-9_-]+$/u;

interface Checkout {
  root: string;
  mainRoot: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execa("git", ["-C", cwd, ...args])).stdout.trim();
}

async function resolveCheckout(): Promise<Checkout> {
  const root = await git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const common = await git(process.cwd(), ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return { root, mainRoot: path.dirname(common) };
}

/** Same rule as `current_workstream` in `bin/exhibits`. */
async function currentWorkstream(checkout: Checkout): Promise<string> {
  if (fs.realpathSync(checkout.root) === fs.realpathSync(checkout.mainRoot)) return "main";
  const branch = await git(checkout.root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch.startsWith("worktree-") ? branch.slice("worktree-".length) : path.basename(checkout.root);
}

function validWorkstream(name: string): string {
  if (!NAME.test(name) || name === "apps") throw new InvalidWorkstreamError(name);
  return name;
}

function storeRoot(checkout: Checkout): string {
  const override = process.env["BBX_EXHIBITS_ROOT"];
  const root = override ? path.resolve(override) : path.join(path.dirname(checkout.mainRoot), "workstream-exhibits");
  const checkoutReal = fs.realpathSync(checkout.root);
  const rootReal = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
  if (rootReal === checkoutReal || rootReal.startsWith(`${checkoutReal}/`)) {
    throw new StoreInsideCheckoutError(root);
  }
  return root;
}

/** Marker discipline from `bin/lib/exhibits-store.sh`: adopt no unmarked directory. */
function ensureStoreRoot(root: string): void {
  if (fs.existsSync(root)) {
    if (!fs.existsSync(path.join(root, STORE_MARKER))) throw new UnmarkedStoreError(root, STORE_MARKER);
    return;
  }
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, STORE_MARKER), "");
}

async function readBody(file: string | undefined): Promise<string> {
  if (file !== undefined) return fs.readFileSync(file, "utf8");
  if (process.stdin.isTTY) process.stderr.write(`Answer each prompt, then end input (Ctrl-D):\n${PROMPTS.join("\n")}\n`);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

/** Never overwrites: a same-second entry gets the next `-<n>` name. */
function writeExclusive(dir: string, entry: { name: (attempt: number) => string; contents: string }): string {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const file = path.join(dir, entry.name(attempt));
    try {
      fs.writeFileSync(file, entry.contents, { flag: "wx" });
      return file;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new NoFreeEntryNameError(dir);
}

async function add(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      checkpoint: { type: "string" }, workstream: { type: "string" }, engine: { type: "string" },
      session: { type: "string" }, transcript: { type: "string" }, file: { type: "string" },
    },
  });
  const checkpoint = values.checkpoint ?? "";
  if (!isCheckpoint(checkpoint)) throw new InvalidCheckpointError(CHECKPOINTS);
  const engine = values.engine;
  if (engine !== undefined && !isEngine(engine)) throw new InvalidEngineError(ENGINES);
  const body = normalizeBody(await readBody(values.file));
  if (body === null) throw new EmptyBodyError(PROMPTS);

  const checkout = await resolveCheckout();
  const workstream = validWorkstream(values.workstream ?? (await currentWorkstream(checkout)));
  const root = storeRoot(checkout);
  const now = new Date();
  const session = await resolveSession({
    home: os.homedir(), env: process.env, now,
    checkoutRoots: [...new Set([checkout.root, fs.realpathSync(checkout.root)])],
    ...(engine === undefined ? {} : { engine }),
    ...(values.session === undefined ? {} : { session: values.session }),
    ...(values.transcript === undefined ? {} : { transcript: values.transcript }),
  });
  if (session.resolvedBy === "none") process.stderr.write("coding-feedback: no session transcript found; writing the entry without one\n");
  const contents = formatEntry({
    timestamp: now.toISOString(), workstream, checkpoint,
    head: await git(checkout.root, ["rev-parse", "HEAD"]),
    branch: await git(checkout.root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: (await git(checkout.root, ["status", "--porcelain"])) !== "",
    ...session,
  }, body);
  ensureStoreRoot(root);
  const dir = path.join(root, workstream, FEEDBACK_DIR);
  fs.mkdirSync(dir, { recursive: true });
  process.stdout.write(`${writeExclusive(dir, { name: (attempt) => entryFileName({ date: now, checkpoint, attempt }), contents })}\n`);
}

function entriesIn(root: string, workstream: string): ListedEntry[] {
  const dir = path.join(root, workstream, FEEDBACK_DIR);
  if (!fs.existsSync(dir)) return [];
  const out: ListedEntry[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const file = path.join(dir, name);
    const parsed = parseEntry(fs.readFileSync(file, "utf8"));
    if (!parsed.ok) {
      process.stderr.write(`coding-feedback: skipping ${file}: ${parsed.problem}\n`);
      continue;
    }
    const { timestamp, checkpoint, engine, sessionId } = parsed.meta;
    out.push({ path: file, timestamp, workstream, checkpoint, engine, sessionId });
  }
  return out;
}

async function list(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { workstream: { type: "string" }, all: { type: "boolean" }, since: { type: "string" }, json: { type: "boolean" } },
  });
  if (values.all && values.workstream !== undefined) throw new AllWithWorkstreamError();
  const since = values.since;
  if (since !== undefined && !isIsoInstant(since)) throw new InvalidSinceError(since);
  const checkout = await resolveCheckout();
  const root = storeRoot(checkout);
  const workstreams = values.all
    ? (fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && NAME.test(e.name)).map((e) => e.name) : [])
    : [validWorkstream(values.workstream ?? (await currentWorkstream(checkout)))];
  const entries = newestFirst(workstreams.flatMap((ws) => entriesIn(root, ws)))
    .filter((entry) => since === undefined || Date.parse(entry.timestamp) > Date.parse(since));
  if (values.json) process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
  else for (const entry of entries) process.stdout.write(`${formatListLine(entry)}\n`);
}

async function show(argv: string[]): Promise<void> {
  const target = argv[0];
  if (target === undefined || argv.length > 1) throw new ShowArgumentsError();
  const root = fs.realpathSync(storeRoot(await resolveCheckout()));
  const file = fs.realpathSync(path.resolve(target));
  const rel = path.relative(root, file).split(path.sep);
  if (rel[0] === ".." || path.isAbsolute(rel.join(path.sep)) || rel[1] !== FEEDBACK_DIR) throw new NotAnEntryError(target, root);
  process.stdout.write(fs.readFileSync(file, "utf8"));
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === "add") await add(rest);
  else if (command === "list") await list(rest);
  else if (command === "show") await show(rest);
  else if (command === undefined || command === "help" || command === "--help") process.stdout.write(USAGE);
  else throw new UnknownCommandError(command, USAGE);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  const expected = error instanceof UsageError || code.startsWith("ERR_PARSE_ARGS") || code === "ENOENT";
  if (!expected || !(error instanceof Error)) throw error;
  process.stderr.write(`coding-feedback: ${error.message}\n`);
  process.exitCode = 2;
}
