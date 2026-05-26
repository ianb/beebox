#!/usr/bin/env npx tsx
/**
 * Collect agent feedback from all boxes (local and remote server).
 *
 * Usage:
 *   npx tsx collect.ts                    # list all unresolved feedback
 *   npx tsx collect.ts --resolve <file>   # mark one file resolved (moves to resolved/)
 *   npx tsx collect.ts --resolve-all      # mark all collected feedback resolved
 *   npx tsx collect.ts --boxes ~/src/boxes # scan a different local directory
 *   npx tsx collect.ts --no-remote        # skip remote server
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOX_MARKER = ".cb-box";
const FEEDBACK_DIR = path.join("config", "feedback");
const RESOLVED_DIR = path.join("config", "feedback", "resolved");
const REMOTE_BOXES_DIR = "/home/callback/boxes";

function getRemoteHost(): string | null {
  const serverIpFile = path.join(__dirname, "..", "callback-box", "deploy", "server-ip");
  try {
    return fs.readFileSync(serverIpFile, "utf-8").trim();
  } catch {
    return null;
  }
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
      files = fs.readdirSync(feedbackDir).filter((f) => f.endsWith(".md"));
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
  let findOutput: string;
  try {
    findOutput = execSync(
      `ssh root@${host} 'find ${REMOTE_BOXES_DIR} -maxdepth 5 -path "*/config/feedback/*.md" ! -path "*/resolved/*" 2>/dev/null'`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (e) {
    console.error(`Warning: could not reach remote host ${host}: ${(e as Error).message}`);
    return [];
  }

  const files = findOutput.trim().split("\n").filter(Boolean);
  const items: FeedbackFile[] = [];

  for (const filePath of files.sort()) {
    // Path format: /home/callback/boxes/<boxname>/config/feedback/<file>
    const boxName = filePath.split("/")[4];
    if (!boxName) continue;
    const boxRoot = `${REMOTE_BOXES_DIR}/${boxName}`;
    const relPath = filePath.slice(boxRoot.length + 1);

    let content: string;
    try {
      content = execSync(`ssh root@${host} 'cat ${JSON.stringify(filePath)}'`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      continue;
    }

    items.push({
      boxRoot,
      boxName: `remote:${boxName}`,
      filePath,
      relPath,
      content,
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
  const host = item.remoteHost!;
  const destPath = item.filePath.replace(
    "/config/feedback/",
    "/config/feedback/resolved/"
  );
  const destRel = item.relPath.replace(
    "config/feedback/",
    "config/feedback/resolved/"
  );

  const cmd = [
    `mkdir -p ${JSON.stringify(path.dirname(destPath))}`,
    `mv ${JSON.stringify(item.filePath)} ${JSON.stringify(destPath)}`,
    `git -C ${JSON.stringify(item.boxRoot)} add ${JSON.stringify(item.relPath)} ${JSON.stringify(destRel)}`,
    `git -C ${JSON.stringify(item.boxRoot)} commit -m ${JSON.stringify(`resolve agent feedback: ${path.basename(item.filePath)}`)}`,
  ].join(" && ");

  try {
    execSync(`ssh root@${host} '${cmd}'`, { stdio: "pipe" });
    console.log(`Resolved: [${item.boxName}] ${path.basename(item.filePath)}`);
  } catch (err) {
    console.error(`Remote git error resolving ${item.filePath}: ${(err as Error).message}`);
  }
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
      console.error("Warning: could not read deploy/server-ip, skipping remote collection.");
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
