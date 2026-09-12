/**
 * Report local boxes that have drifted behind the shipped migrations.
 *
 * Prod converges on every deploy: `beebox/deploy/deploy.sh` walks
 * `/home/beebox/boxes/*` and runs `bbx migrate --sweep` per box in the at-rest
 * window. Nothing does that for the developer's local boxes, so they sit at
 * whatever migration level they were last hand-migrated to. One was found 12
 * migrations and 6 days behind, discovered only because a card the boxholder
 * expected was missing.
 *
 * **This reports; it does not apply.** A local box is routinely dirty — the
 * developer is working in it — and `--sweep` skips a dirty box silently, which
 * would turn "behind" into "behind and quiet". Applying data migrations under
 * someone's uncommitted work is also a bigger promise than a drift report
 * needs to make. The alert names the one command that fixes each box.
 *
 * Which boxes: the `BOXES=` line in `beebox/.env`, the same list the dev router
 * reads (`workstreams-app/src/router/router-real-effects.ts`). Deliberately not
 * a second source of truth about where boxes live. A worktree's `.env` has no
 * `BOXES=` line (`bin/lib/worktree-create.sh` strips it), so this reports on
 * the developer's real boxes and never on a worktree's cloned box.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { execa } from "execa";

import { errnoCode } from "../../beebox/src/lib/error-guards.js";
import { computePending, readManifest } from "../../beebox/src/core/migration-run.js";
import { getStatus } from "../../beebox/src/lib/git.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";

/** Expand a leading `~` — `BOXES=` is written the way a person types a path. */
function expandHome(entry: string): string {
  return entry.startsWith("~/") ? path.join(os.homedir(), entry.slice(2)) : entry;
}

async function boxPaths(): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(path.join(REPO_ROOT, "beebox", ".env"), "utf8");
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    return []; // No .env: nothing local is configured, so nothing to report.
  }
  const line = text.split("\n").find((l) => l.startsWith("BOXES="));
  if (!line) return [];
  return line.slice("BOXES=".length).trim().split(/\s+/u).filter(Boolean).map(expandHome);
}

interface Drift {
  readonly box: string;
  readonly pending: string[];
  readonly dirty: boolean;
}

async function inspect(boxRoot: string): Promise<Drift | null> {
  const manifest = await readManifest(boxRoot);
  // A manifest-less box predates `bbx migrate` and needs a human decision
  // (`bbx migrate --mark-all-applied` or a real migration), which is not this
  // job's call to make — and not drift in the sense being reported.
  if (manifest === null) return null;
  const pending = computePending(manifest).map((m) => m.name);
  if (pending.length === 0) return null;
  const status = await getStatus(boxRoot).catch(() => null);
  return { box: path.basename(boxRoot), pending, dirty: status === null || !status.clean };
}

const drifted: Drift[] = [];
for (const boxRoot of await boxPaths()) {
  try {
    const drift = await inspect(boxRoot);
    if (drift) drifted.push(drift);
  } catch (error) {
    // One unreadable box must not hide the others. Report it as drift of
    // unknown size rather than swallowing it.
    drifted.push({ box: path.basename(boxRoot), pending: [`(unreadable: ${errnoCode(error) ?? "error"})`], dirty: false });
  }
}

if (drifted.length === 0) process.exit(0);

const message = [
  `${String(drifted.length)} local box(es) behind the shipped migrations.`,
  "",
  ...drifted.flatMap((d) => [
    `**${d.box}** — ${String(d.pending.length)} pending${d.dirty ? ", working tree dirty" : ""}`,
    `  ${d.pending.slice(0, 8).join(", ")}${d.pending.length > 8 ? `, +${String(d.pending.length - 8)} more` : ""}`,
    d.dirty
      ? "  A dirty box cannot be swept — commit or stash first, then `bbx migrate --apply`."
      : "  Fix with `bbx migrate --apply` in that box.",
  ]),
].join("\n");

if (dryRun) {
  process.stdout.write(`[box-convergence] would report ${String(drifted.length)} drifted box(es)\n${message}\n`);
} else {
  await execa(path.join(REPO_ROOT, "bin", "schedules"), [
    "alert", "--priority", "normal", "--title", `${String(drifted.length)} local box(es) behind on migrations`, "--message", message,
  ], { stdout: "inherit", stderr: "inherit" });
}
