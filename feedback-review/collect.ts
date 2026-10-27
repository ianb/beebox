#!/usr/bin/env -S pnpm dlx tsx
/**
 * Collect agent feedback from all boxes (local and remote server).
 *
 * Usage:
 *   pnpm dlx tsx collect.ts                    # list all unresolved feedback
 *   pnpm dlx tsx collect.ts --resolve <file>   # mark one file resolved (moves to resolved/)
 *   pnpm dlx tsx collect.ts --resolve-all      # mark all collected feedback resolved
 *   pnpm dlx tsx collect.ts --boxes ~/src/boxes # scan a different local directory
 *   pnpm dlx tsx collect.ts --no-remote        # skip remote server
 *   pnpm dlx tsx collect.ts --ssh-target root@host  # a server other than the deploy target
 *
 * On the server each box is private to its own user (`bbx-<slug>`), so the
 * collector lists the boxes from the hub's `hub.json` as `beebox`, then scans,
 * reads and resolves each box's feedback as that box's user.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { deployTarget } from "../bin/deploy-target.js";

import { boxUser, runOnServer, type BoxUser } from "./run-on-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOX_MARKER = ".beebox";
const FEEDBACK_DIR = path.join("_config", "feedback");
const RESOLVED_DIR = path.join("_config", "feedback", "resolved");
/** The hub's routing table: every box's slug and root (`beebox/docs/server/provisioning.md`). */
const REMOTE_HUB_CONFIG = "/home/beebox/.config/beebox/hub.json";


const DIRECTORY_DOCS = new Set(["AGENTS.md", "CLAUDE.md", "MAP.md", "README.md"]);

function isFeedbackFilename(name: string): boolean {
  return name.endsWith(".doc.card");
}

function isCandidate(name: string): boolean {
  return !name.startsWith(".") && !DIRECTORY_DOCS.has(name);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function getRemoteSshTarget(): string | null {
  return deployTarget(path.join(__dirname, ".."))?.sshTarget ?? null;
}

function parseArgs(): {
  boxesDir: string;
  resolve: string | null;
  resolveAll: boolean;
  noRemote: boolean;
  sshTarget: string | null;
} {
  const args = process.argv.slice(2);
  let boxesDir = path.join(os.homedir(), "src", "boxes");
  let resolve: string | null = null;
  let resolveAll = false;
  let noRemote = false;
  let sshTarget: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--boxes" && args[i + 1]) {
      boxesDir = args[++i]!;
    } else if (args[i] === "--resolve" && args[i + 1]) {
      resolve = args[++i]!;
    } else if (args[i] === "--resolve-all") {
      resolveAll = true;
    } else if (args[i] === "--no-remote") {
      noRemote = true;
    } else if (args[i] === "--ssh-target" && args[i + 1]) {
      sshTarget = args[++i]!;
    }
  }

  return { boxesDir, resolve, resolveAll, noRemote, sshTarget };
}

function findLocalBoxes(boxesDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(boxesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(boxesDir, e.name))
    .filter((boxPath) => fs.existsSync(path.join(boxPath, BOX_MARKER)));
}

interface FeedbackFile {
  boxRoot: string;
  boxName: string;
  filePath: string;
  relPath: string;
  content: string;
  remote?: { sshTarget: string; user: BoxUser };
}

function collectLocalFeedback(boxes: string[], errors: string[], requireDirectory: boolean): FeedbackFile[] {
  const items: FeedbackFile[] = [];
  let feedbackDirsFound = 0;

  for (const boxRoot of boxes) {
    const feedbackDir = path.join(boxRoot, FEEDBACK_DIR);
    if (!fs.existsSync(feedbackDir)) continue;
    feedbackDirsFound++;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(feedbackDir, { withFileTypes: true });
    } catch (err) {
      errors.push(`Cannot scan ${feedbackDir}: ${String(err)}`);
      continue;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = entry.name;
      if (!isCandidate(file) || entry.isDirectory()) continue;
      if (!entry.isFile() || !isFeedbackFilename(file)) {
        errors.push(`Unrecognized feedback file: ${path.join(feedbackDir, file)}`);
        continue;
      }
      const filePath = path.join(feedbackDir, file);
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch (err) {
        errors.push(`Cannot read ${filePath}: ${String(err)}`);
        continue;
      }

      items.push({
        boxRoot,
        boxName: path.basename(boxRoot),
        filePath,
        relPath: path.relative(boxRoot, filePath),
        content,
      });
    }
  }

  if (requireDirectory && boxes.length > 0 && feedbackDirsFound === 0) {
    errors.push(`No _config/feedback/ directories found in ${boxes.length} local box(es); check the feedback path.`);
  }

  return items;
}

interface RemoteBox {
  slug: string;
  root: string;
}

/** The boxes in the server's `hub.json`, read as the hub user. */
function listRemoteBoxes(sshTarget: string, errors: string[]): RemoteBox[] {
  const read = runOnServer({ sshTarget, script: `cat ${shellQuote(REMOTE_HUB_CONFIG)}` });
  if (read.exitCode !== 0) {
    errors.push(`Cannot read ${REMOTE_HUB_CONFIG} on ${sshTarget}: ${read.stderr.trim() || `exit ${read.exitCode}`}`);
    return [];
  }
  let config: unknown;
  try {
    config = JSON.parse(read.stdout);
  } catch (err) {
    errors.push(`Cannot parse ${REMOTE_HUB_CONFIG} on ${sshTarget}: ${String(err)}`);
    return [];
  }
  const boxes = typeof config === "object" && config !== null && "boxes" in config ? config.boxes : undefined;
  if (typeof boxes !== "object" || boxes === null) {
    errors.push(`${REMOTE_HUB_CONFIG} on ${sshTarget} has no boxes object`);
    return [];
  }
  const found: RemoteBox[] = [];
  for (const [slug, entry] of Object.entries(boxes)) {
    const root: unknown = typeof entry === "object" && entry !== null && "path" in entry ? entry.path : undefined;
    if (typeof root !== "string" || !root.startsWith("/")) {
      errors.push(`${REMOTE_HUB_CONFIG} on ${sshTarget}: box ${JSON.stringify(slug)} has no absolute path`);
      continue;
    }
    found.push({ slug, root });
  }
  return found.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Exit status of the scan script when the box has no feedback directory. */
const NO_FEEDBACK_DIR = 3;

function collectRemoteFeedback(sshTarget: string, errors: string[]): FeedbackFile[] {
  const boxes = listRemoteBoxes(sshTarget, errors);
  const items: FeedbackFile[] = [];
  let feedbackDirsFound = 0;

  for (const box of boxes) {
    const user = boxUser(box.slug);
    const feedbackDir = `${box.root}/${FEEDBACK_DIR}`;
    const find = runOnServer({
      sshTarget,
      asUser: user,
      script: [
        // A box root this user cannot reach is an error, not an empty inbox.
        `test -d ${shellQuote(box.root)} || { echo ${shellQuote(`box root ${box.root} is not a readable directory`)} >&2; exit 1; }`,
        `test -d ${shellQuote(feedbackDir)} || exit ${NO_FEEDBACK_DIR}`,
        `find ${shellQuote(feedbackDir)} -mindepth 1 -maxdepth 1 -type f -print`,
      ].join("\n"),
    });
    if (find.exitCode === NO_FEEDBACK_DIR) continue;
    if (find.exitCode !== 0) {
      errors.push(`Cannot scan ${feedbackDir} as ${user} on ${sshTarget}: ${find.stderr.trim() || `exit ${find.exitCode}`}`);
      continue;
    }
    feedbackDirsFound++;

    for (const filePath of find.stdout.trim().split("\n").filter(Boolean).sort()) {
      const file = path.basename(filePath);
      if (!isCandidate(file)) continue;
      if (!isFeedbackFilename(file)) {
        errors.push(`Unrecognized remote feedback file: ${filePath}`);
        continue;
      }
      const read = runOnServer({ sshTarget, asUser: user, script: `cat ${shellQuote(filePath)}` });
      if (read.exitCode !== 0) {
        errors.push(`Cannot read ${filePath}: ${read.stderr.trim() || `exit ${read.exitCode}`}`);
        continue;
      }
      items.push({
        boxRoot: box.root,
        boxName: `remote:${box.slug}`,
        filePath,
        relPath: `${FEEDBACK_DIR}/${file}`,
        content: read.stdout,
        remote: { sshTarget, user },
      });
    }
  }

  if (boxes.length > 0 && feedbackDirsFound === 0) {
    errors.push(`No _config/feedback/ directories found in ${boxes.length} remote box(es); check the feedback path.`);
  }

  return items;
}

function resolveLocalFile(item: FeedbackFile): boolean {
  const dest = path.join(item.boxRoot, RESOLVED_DIR, path.basename(item.filePath));
  if (fs.existsSync(dest)) {
    console.error(`Resolved destination already exists: ${dest}`);
    return false;
  }
  const destRel = path.relative(item.boxRoot, dest);
  try {
    execFileSync(path.join(__dirname, "..", "beebox", "bin", "bbx"), ["mv", "--commit", item.relPath, destRel], {
      cwd: item.boxRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
    console.log(`Resolved: [${item.boxName}] ${path.basename(item.filePath)}`);
    return true;
  } catch (err) {
    const details = err as Error & { stderr?: Buffer | string };
    const reason = details.stderr?.toString().trim() || String(err);
    console.error(`bbx mv failed resolving ${item.filePath}: ${reason}. The box may contain partial changes; inspect it before retrying.`);
    return false;
  }
}

function resolveRemoteFile(item: FeedbackFile, remote: NonNullable<FeedbackFile["remote"]>): boolean {
  const destPath = item.filePath.replace(
    "/_config/feedback/",
    "/_config/feedback/resolved/"
  );
  const destRel = item.relPath.replace(
    "_config/feedback/",
    "_config/feedback/resolved/"
  );

  // Runs as the box's own user; the deployed CLI lives at this stable symlink
  // and commits the move and rewritten referrers by path.
  const script = [
    "set -e",
    `test ! -e ${shellQuote(destPath)} || { echo 'Resolved destination already exists' >&2; exit 1; }`,
    `cd ${shellQuote(item.boxRoot)}`,
    `BBX_CLI_PREBUILT=1 /usr/local/bin/bbx mv --commit ${shellQuote(item.relPath)} ${shellQuote(destRel)}`,
  ].join("\n");

  const r = runOnServer({ sshTarget: remote.sshTarget, asUser: remote.user, script });
  if (r.exitCode !== 0) {
    console.error(`Remote bbx mv failed resolving ${item.filePath}: ${r.stderr.trim() || `exit ${r.exitCode}`}. The box may contain partial changes; inspect it before retrying.`);
    return false;
  }
  console.log(`Resolved: [${item.boxName}] ${path.basename(item.filePath)}`);
  return true;
}

function resolveFile(item: FeedbackFile): boolean {
  if (item.remote) {
    return resolveRemoteFile(item, item.remote);
  }
  return resolveLocalFile(item);
}

function printFeedback(items: FeedbackFile[]): void {
  if (items.length === 0) {
    console.log("No unresolved agent feedback found.");
    return;
  }

  console.log(`Found ${items.length} unresolved feedback item(s):\n`);

  for (const item of items) {
    const separator = "─".repeat(72);
    console.log(separator);
    console.log(`[${item.boxName}] ${path.basename(item.filePath)}`);
    console.log(separator);
    console.log(item.content.trim());
    console.log();
  }
}

async function main(): Promise<void> {
  const { boxesDir, resolve, resolveAll, noRemote, sshTarget } = parseArgs();

  const localBoxes = findLocalBoxes(boxesDir);
  const errors: string[] = [];
  if (noRemote && localBoxes.length === 0) {
    errors.push(`No local boxes found in ${boxesDir}; check --boxes.`);
  }
  const items: FeedbackFile[] = collectLocalFeedback(localBoxes, errors, noRemote);

  if (!noRemote) {
    const remoteSshTarget = sshTarget ?? getRemoteSshTarget();
    if (remoteSshTarget) {
      items.push(...collectRemoteFeedback(remoteSshTarget, errors));
    } else {
      errors.push("No deploy target configured (beebox/deploy/target.env); remote collection was not run. Use --no-remote for a local-only scan.");
    }
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    throw new Error(`Feedback scan incomplete (${errors.length} error(s)); no items were resolved.`);
  }

  if (resolve !== null) {
    const match = items.find(
      (item) =>
        path.basename(item.filePath) === resolve ||
        item.filePath === resolve ||
        item.relPath === resolve
    );
    if (!match) {
      console.error(`Feedback file not found: ${resolve}`);
      console.error("Run without --resolve to list available files.");
      process.exit(1);
    }
    if (!resolveFile(match)) process.exitCode = 1;
    return;
  }

  if (resolveAll) {
    for (const item of items) {
      if (!resolveFile(item)) {
        process.exitCode = 1;
        break;
      }
    }
    return;
  }

  printFeedback(items);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
