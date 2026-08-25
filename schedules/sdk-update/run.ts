/**
 * The head of the Agent SDK release monitor: is there anything published that
 * the ledger has not reviewed yet?
 *
 * Deliberately cheap and deliberately dumb — VERSIONS ONLY. It reads two npm
 * registries and one line of `docs/agent-sdk-notes.md`, and it never fetches a
 * changelog, never reads callback-box's source, and never judges relevance.
 * All of that is the session's work, and starting an Opus session every day to
 * discover "nothing was published" is the cost this head exists to avoid.
 *
 * Two packages, because two channels reach this repo. RUNTIME is
 * `@anthropic-ai/claude-agent-sdk`, which callback-box imports. HARNESS is
 * `@anthropic-ai/claude-code`, the CLI every worker session runs in — most SDK
 * releases say only "parity with Claude Code v2.1.N", and a Claude Code change
 * with zero SDK API surface can still break this repo (v2.1.218's worktree git
 * isolation silently broke `/finish`'s merge step for days).
 *
 * The baseline is the ledger's own header line, not the installed pin: the
 * ledger records versions it has *reviewed*, which is ahead of what is applied.
 *
 * Was the launchd half of `bin/update-agent-sdk-scheduled.sh`, which resumed
 * the session unconditionally, every day, whether or not anything had shipped.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";

const SCHEDULE_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCHEDULE_DIR, "..", "..");
const LEDGER = path.join(REPO_ROOT, "docs", "agent-sdk-notes.md");

/** The two npm packages, in the order the briefing lists them. */
const PACKAGES = [
  { channel: "SDK", npmName: "@anthropic-ai/claude-agent-sdk" },
  { channel: "Claude Code", npmName: "@anthropic-ai/claude-code" },
];

/**
 * The ledger's own statement of where it has read to, maintained by the
 * session in the header:
 *
 *     - **Latest reviewed upstream version:** `0.3.241` (SDK), `2.1.241` (Claude Code)
 */
const REVIEWED_PATTERN =
  /^- \*\*Latest reviewed upstream version:\*\*\s*`([^`]+)`\s*\(SDK\),\s*`([^`]+)`\s*\(Claude Code\)/mu;

function refuse(message: string): never {
  // Non-zero is the report: the runner turns it into an `important` alert with
  // the log tail, which is what a monitor that cannot find its own baseline
  // deserves — reviewing from a guessed floor would re-file months of releases.
  process.stderr.write(`sdk-update: ${message}\n`);
  process.exit(2);
}

/** Numeric dotted compare; prereleases never reach it (filtered below). */
function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const difference = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isStable(version: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+$/u.test(version);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every published version of one package. The abbreviated-metadata Accept
 * header is the difference between a few KB and several MB: the full document
 * carries every release's manifest, and this schedule wants the key list.
 */
async function publishedVersions(npmName: string): Promise<string[]> {
  const url = `https://registry.npmjs.org/${npmName.replace("/", "%2f")}`;
  const response = await fetch(url, { headers: { accept: "application/vnd.npm.install-v1+json" } });
  if (!response.ok) refuse(`npm returned ${String(response.status)} for ${npmName}`);
  const payload: unknown = await response.json();
  const versions = isRecord(payload) ? payload["versions"] : undefined;
  if (!isRecord(versions)) refuse(`unexpected npm payload for ${npmName}`);
  return Object.keys(versions);
}

async function readBaselines(): Promise<{ channel: string; version: string }[]> {
  const text = await fs.readFile(LEDGER, "utf8");
  const match = REVIEWED_PATTERN.exec(text);
  const sdk = match?.[1];
  const claudeCode = match?.[2];
  if (sdk === undefined || claudeCode === undefined) {
    refuse('docs/agent-sdk-notes.md has no "Latest reviewed upstream version" line to measure from');
  }
  return [
    { channel: "SDK", version: sdk },
    { channel: "Claude Code", version: claudeCode },
  ];
}

const baselines = await readBaselines();
const sections: string[] = [];
let newCount = 0;

for (const { channel, npmName } of PACKAGES) {
  const baseline = baselines.find((entry) => entry.channel === channel)?.version;
  if (baseline === undefined) refuse(`no ledger baseline for ${channel}`);
  const newer = (await publishedVersions(npmName))
    .filter((version) => isStable(version) && compareVersions(version, baseline) > 0)
    .toSorted(compareVersions);
  newCount += newer.length;
  sections.push(
    newer.length === 0
      ? `- **${channel}** (\`${npmName}\`): nothing newer than \`${baseline}\`.`
      : `- **${channel}** (\`${npmName}\`), newer than the ledger's \`${baseline}\`: ${newer.map((version) => `\`${version}\``).join(", ")}`,
  );
}

// Nothing published since the last turn: exit 0, silently, and start no
// session. This is the normal outcome most days.
if (newCount === 0) process.exit(0);

const title = `${String(newCount)} unreviewed release${newCount === 1 ? "" : "s"}`;
const body = [
  "Published since the ledger's last reviewed versions:",
  "",
  ...sections,
  "",
  "This head checked versions only — it read no changelogs and judged no",
  "relevance. Assess each one on both channels, update",
  "`docs/agent-sdk-notes.md`, and bump the pin if the rules in your system",
  "prompt say to.",
  "",
].join("\n");

if (process.env["SCHEDULE_DRY_RUN"] === "1") {
  // `bin/schedules handoff` is still the one that decides what a dry run does
  // with this (it prints rather than writes), so the call below is made either
  // way — this line only says which mode produced it.
  console.log("[sdk-update] dry run: the handoff below is printed, not recorded.");
}
await execa(path.join(REPO_ROOT, "bin", "schedules"), ["handoff", "--title", title, "--body", "-"], {
  input: body,
  stdout: "inherit",
  stderr: "inherit",
});
