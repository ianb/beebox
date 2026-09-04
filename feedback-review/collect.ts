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
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { deployTarget } from "../bin/deploy-target.js";

import { runOnServer } from "./run-on-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOX_MARKER = ".beebox";
const FEEDBACK_DIR = path.join("config", "feedback");
const RESOLVED_DIR = path.join("config", "feedback", "resolved");
const REMOTE_BOXES_DIR = "/home/beebox/boxes";

// `bbx feedback` names every item `YYYY-MM-DDTHH-MM-SS-<slug>.md`. Match only
// that shape so the feedback dir's own docs (CLAUDE.md, MAP.md, README.md) are
// never collected — and, critically, never swept into resolved/ by --resolve-all.
function isFeedbackFilename(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-.+\.md$/.test(name);
}

function getRemoteHost(): string | null {
  return deployTarget(path.join(__dirname, ".."))?.host ?? null;
}

function parseArgs(): {
  boxesDir: string;
  resolve: string | null;
  resolveAll: boolean;
  noRemote: boolean;
} {
  const args = process.argv.slice(2);
  let boxesDir = path.join(os.homedir(), "src", "boxes");
  let resolve: string | null = null;
  let resolveAll = false;
  let noRemote = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--boxes" && args[i + 1]) {
      boxesDir = args[++i]!;
    } else if (args[i] === "--resolve" && args[i + 1]) {
      resolve = args[++i]!;
    } else if (args[i] === "--resolve-all") {
      resolveAll = true;
    } else if (args[i] === "--no-remote") {
      noRemote = true;
    }
  }

  return { boxesDir, resolve, resolveAll, noRemote };
}

function findLocalBoxes(boxesDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(boxesDir, { withFileTypes: true });
  } catch {
    return [];
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
  remoteHost?: string;
}

function collectLocalFeedback(boxes: string[]): FeedbackFile[] {
  const items: FeedbackFile[] = [];

  for (const boxRoot of boxes) {
    const feedbackDir = path.join(boxRoot, FEEDBACK_DIR);
    if (!fs.existsSync(feedbackDir)) continue;

    let files: string[];
    try {
      files = fs.readdirSync(feedbackDir).filter(isFeedbackFilename);
    } catch {
      continue;
    }

    for (const file of files.sort()) {
      const filePath = path.join(feedbackDir, file);
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
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

  return items;
}

function collectRemoteFeedback(host: string): FeedbackFile[] {
  const find = runOnServer({
    host,
    script: `find ${REMOTE_BOXES_DIR} -maxdepth 5 -path "*/config/feedback/*.md" ! -path "*/resolved/*" 2>/dev/null`,
  });
  if (find.exitCode !== 0) {
    console.error(`Warning: could not reach remote host ${host}: ${find.stderr.trim()}`);
    return [];
  }

  const files = find.stdout.trim().split("\n").filter(Boolean).filter((p) => isFeedbackFilename(path.basename(p)));
  const items: FeedbackFile[] = [];

  for (const filePath of files.sort()) {
    // Path format: /home/beebox/boxes/<boxname>/config/feedback/<file>
    const boxName = filePath.split("/")[4];
    if (!boxName) continue;
    const boxRoot = `${REMOTE_BOXES_DIR}/${boxName}`;
    const relPath = filePath.slice(boxRoot.length + 1);

    const read = runOnServer({
      host,
      script: `cat ${JSON.stringify(filePath)}`,
    });
    if (read.exitCode !== 0) continue;

    items.push({
      boxRoot,
      boxName: `remote:${boxName}`,
      filePath,
      relPath,
      content: read.stdout,
      remoteHost: host,
    });
  }

  return items;
}

function resolveLocalFile(item: FeedbackFile): void {
  const resolvedDir = path.join(item.boxRoot, RESOLVED_DIR);
  fs.mkdirSync(resolvedDir, { recursive: true });

  const dest = path.join(resolvedDir, path.basename(item.filePath));
  fs.renameSync(item.filePath, dest);

  const srcRel = item.relPath;
  const destRel = path.relative(item.boxRoot, dest);

  try {
    execSync(
      `git -C ${JSON.stringify(item.boxRoot)} add ${JSON.stringify(srcRel)} ${JSON.stringify(destRel)}`,
      { stdio: "pipe" }
    );
    execSync(
      `git -C ${JSON.stringify(item.boxRoot)} commit -m "resolve agent feedback: ${path.basename(item.filePath)}"`,
      { stdio: "pipe" }
    );
    console.log(`Resolved: [${item.boxName}] ${path.basename(item.filePath)}`);
  } catch (err) {
    console.error(`Git error resolving ${item.filePath}: ${(err as Error).message}`);
  }
}

function resolveRemoteFile(item: FeedbackFile): void {
  const destPath = item.filePath.replace(
    "/config/feedback/",
    "/config/feedback/resolved/"
  );
  const destRel = item.relPath.replace(
    "config/feedback/",
    "config/feedback/resolved/"
  );

  // Runs as the `beebox` user (run-on-server default). NEVER drop the
  // `su` and let git run as root — root-owned commits leave root-owned
  // objects under .git/objects/ that later block beebox-user commits.
  // See feedback-review/run-on-server.ts for the why.
  const script = [
    "set -e",
    `mkdir -p ${JSON.stringify(path.dirname(destPath))}`,
    `mv ${JSON.stringify(item.filePath)} ${JSON.stringify(destPath)}`,
    `git -C ${JSON.stringify(item.boxRoot)} add ${JSON.stringify(item.relPath)} ${JSON.stringify(destRel)}`,
    `git -C ${JSON.stringify(item.boxRoot)} commit -m ${JSON.stringify(`resolve agent feedback: ${path.basename(item.filePath)}`)}`,
  ].join("\n");

  const r = runOnServer({ host: item.remoteHost!, script });
  if (r.exitCode !== 0) {
    console.error(`Remote git error resolving ${item.filePath}: ${r.stderr.trim()}`);
    return;
  }
  console.log(`Resolved: [${item.boxName}] ${path.basename(item.filePath)}`);
}

function resolveFile(item: FeedbackFile): void {
  if (item.remoteHost) {
    resolveRemoteFile(item);
  } else {
    resolveLocalFile(item);
  }
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
  const { boxesDir, resolve, resolveAll, noRemote } = parseArgs();

  const localBoxes = findLocalBoxes(boxesDir);
  const items: FeedbackFile[] = collectLocalFeedback(localBoxes);

  if (!noRemote) {
    const remoteHost = getRemoteHost();
    if (remoteHost) {
      items.push(...collectRemoteFeedback(remoteHost));
    } else {
      console.error("Warning: no deploy target configured (beebox/deploy/target.env), skipping remote collection.");
    }
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
    resolveFile(match);
    return;
  }

  if (resolveAll) {
    for (const item of items) {
      resolveFile(item);
    }
    return;
  }

  printFeedback(items);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
