/**
 * `bin/skill-usage.ts` — how the repo's skills are actually used, measured
 * from local Claude Code transcripts (`~/.claude/projects/`) and Codex
 * rollouts (`~/.codex/sessions/`) whose cwd is this repo or one of its
 * worktrees.
 *
 *   node --import tsx bin/skill-usage.ts [--since 60] [--json] [--skills-dir .claude/skills]
 *
 * Per skill and source it counts human invocations, agent invocations, body
 * loads, and briefing mentions (first user message, Agent/spawn_agent
 * prompts), with distinct sessions; plus a loaded-but-unused proxy, mention
 * forms, a monthly trend, and catalog-labelled recurring human instructions
 * and tool failures. It never prints transcript text: output is names,
 * labels, dates, and counts. Marker shapes are documented in
 * `lib/skill-usage-claude.ts` and `lib/skill-usage-codex.ts`.
 */

import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";

import { loadCatalog, mentionNames } from "./lib/skill-usage-catalog.ts";
import { scanClaude } from "./lib/skill-usage-claude.ts";
import { scanCodex } from "./lib/skill-usage-codex.ts";
import { renderJson, renderMarkdown } from "./lib/skill-usage-report.ts";
import type { ScanContext } from "./lib/skill-usage-scan.ts";
import { UsageStats } from "./lib/skill-usage-stats.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const home = os.homedir();
/** Checkout roots, including the pre-rename `callback-*` paths older transcripts recorded. */
const DEFAULT_ROOTS = ["src/beebox", "src/beebox-worktrees", "src/callback-box", "src/callback-worktrees"].map((p) => path.join(home, p));
/** Loaded-but-unused: the session ended within this many assistant turns of the load. */
const SHORT_TURNS = 3;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      since: { type: "string", default: "60" },
      json: { type: "boolean", default: false },
      "skills-dir": { type: "string", default: path.join(repoRoot, ".claude", "skills") },
      "repo-root": { type: "string", multiple: true },
      "claude-dir": { type: "string", default: path.join(home, ".claude", "projects") },
      "codex-dir": { type: "string", default: path.join(home, ".codex", "sessions") },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write("usage: bin/skill-usage.ts [--since <days>] [--json] [--skills-dir <dir>] [--repo-root <dir>]... [--claude-dir <dir>] [--codex-dir <dir>]\n");
    return;
  }
  const sinceDays = Number(values.since);
  if (!Number.isFinite(sinceDays) || sinceDays <= 0) {
    process.stderr.write("skill-usage: --since must be a positive number of days\n");
    process.exitCode = 2;
    return;
  }
  const catalog = loadCatalog({ skillsDir: values["skills-dir"], home });
  const ctx: ScanContext = {
    catalog, mentionNames: mentionNames(catalog), stats: new UsageStats(),
    sinceMs: Date.now() - sinceDays * 864e5,
    repoRoots: (values["repo-root"] ?? DEFAULT_ROOTS).map((p) => path.resolve(p)),
    shortTurns: SHORT_TURNS,
  };
  await scanClaude(ctx, values["claude-dir"]);
  await scanCodex(ctx, values["codex-dir"]);
  if (values.json) process.stdout.write(`${JSON.stringify(renderJson(ctx.stats, { catalog, sinceDays }), null, 2)}\n`);
  else process.stdout.write(renderMarkdown(ctx.stats, { catalog, sinceDays, shortTurns: SHORT_TURNS }));
}

try {
  await main();
} catch (error) {
  // Node's filesystem errors embed the transcript path, which names the
  // project directory; report only the error code and syscall.
  const field = (k: string): string => (error instanceof Error && k in error ? String(Reflect.get(error, k)) : "");
  const code = field("code");
  if (!code) throw error;
  process.stderr.write(`skill-usage: failed (${code} in ${field("syscall") || "?"})\n`);
  process.exitCode = 1;
}
