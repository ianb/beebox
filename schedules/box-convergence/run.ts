/**
 * Report boxes — local AND production — that have drifted behind the shipped
 * migrations.
 *
 * Local boxes have nothing that converges them, so they sit at whatever level
 * they were last hand-migrated to. One was found 12 migrations and 6 days
 * behind, discovered only because a card the boxholder expected was missing.
 *
 * Production was supposed to be the safe half: `beebox/deploy/deploy.sh` walks
 * `/home/beebox/boxes/*` and runs `bbx engine migrate --sweep` per box in the at-rest
 * window of every deploy. But the sweep SKIPS a box whose tree is dirty at that
 * instant and says "the next deploy will apply them" — so the busiest box, the
 * one most likely to be mid-write during any given window, is the one that can
 * starve. On 2026-09-14 the boxholder found a production box missing an
 * interface card three days after the migration shipped; the deploy log had been
 * printing `Working tree is not clean; skipped 1 pending migration(s)` for that
 * box on every deploy, into a log nobody reads. This schedule covered only local
 * boxes then, which is exactly why nothing said so.
 *
 * **This reports; it does not apply.** A local box is routinely dirty — the
 * developer is working in it — and `--sweep` skips a dirty box silently, which
 * would turn "behind" into "behind and quiet". Applying data migrations under
 * someone's uncommitted work is also a bigger promise than a drift report
 * needs to make. The alert names the one command that fixes each box.
 *
 * Which boxes: locally, the `BOXES=` line in `beebox/.env`, the same list the dev
 * router reads (`workstreams-app/src/router/router-real-effects.ts`).
 * Deliberately not a second source of truth about where boxes live. A worktree's
 * `.env` has no `BOXES=` line (`bin/lib/worktree-create.sh` strips it), so this
 * reports on the developer's real boxes and never on a worktree's cloned box.
 * In production, whatever `/home/beebox/boxes/*` holds, asked over the same ssh
 * helper the deploy uses. A checkout that cannot reach prod (no target
 * configured, a worktree without the deploy credentials) reports the local half
 * and says the prod half was unavailable — silence there would recreate the
 * failure this exists to catch.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { execa } from "execa";

import { errnoCode } from "../../beebox/src/lib/error-guards.js";
import { computePending, readManifest } from "../../beebox/src/core/migration-run.js";
import { getStatus } from "../../beebox/src/lib/git.js";
import { parseProdRows, type Drift } from "./prod-rows.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";
// `bin/schedules alert` needs the run it belongs to. Outside a tick there is no
// run to attach to, so a hand-invocation prints the report rather than failing.
const scheduled = (process.env["SCHEDULE_RUN_ID"] ?? "") !== "";

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


/**
 * Ask production what each box's migration state is, over the deploy's own ssh
 * helper. One remote script rather than a round trip per box: this runs daily and
 * the boxes are few, but a per-box ssh would make the schedule's cost scale with
 * the fleet for no benefit.
 *
 * `null` means the prod half could not be read at all — no configured target, no
 * credentials, an unreachable host. That is reported as unknown rather than as
 * "nothing is behind", because a silent prod half is the exact shape of the
 * failure this schedule exists to catch.
 */
async function prodDrift(): Promise<Drift[] | null> {
  // One remote script, one `bbx engine migrate --status` per box, emitted as
  // `name<TAB>dirtyCount<TAB>pending,names` so the parsing stays on this side.
  const script = [
    "set -u",
    "for d in /home/beebox/boxes/*/; do",
    '  n=$(basename "$d")',
    '  dirty=$(sudo -u beebox git -C "$d" status --porcelain 2>/dev/null | wc -l | tr -d " ")',
    '  status=$(sudo -u beebox -H bash -lc \'set -a; source /home/beebox/.env 2>/dev/null; set +a; cd "$1" && bbx engine migrate --status 2>/dev/null\' probe "$d" 2>/dev/null)',
    // The sed ranges are SINGLE-quoted in the shell: `$p` in a double-quoted
    // string is expanded by bash (unbound under `set -u`), which silently broke
    // the range and made every box look up to date — the same shape of failure
    // this schedule exists to report.
    "  names=$(printf '%s' \"$status\" | sed -n '/^Pending/,$p' | sed -n 's/^  . //p' | tr '\\n' ',')",
    '  printf "%s\\t%s\\t%s\\n" "$n" "$dirty" "$names"',
    "done",
  ].join("\n");
  const result = await execa(path.join(REPO_ROOT, "beebox", "deploy", "prod-ssh"), ["bash -s"], {
    input: script,
    reject: false,
    timeout: 120_000,
  });
  if (result.exitCode !== 0) return null;
  return parseProdRows(result.stdout);
}


async function inspect(boxRoot: string): Promise<Drift | null> {
  const manifest = await readManifest(boxRoot);
  // A manifest-less box predates `bbx engine migrate` and needs a human decision
  // (`bbx engine migrate --mark-all-applied` or a real migration), which is not this
  // job's call to make — and not drift in the sense being reported.
  if (manifest === null) return null;
  const pending = computePending(manifest).map((m) => m.name);
  if (pending.length === 0) return null;
  const status = await getStatus(boxRoot).catch(() => null);
  return { box: path.basename(boxRoot), pending, dirty: status === null || !status.clean, where: "local" };
}

const drifted: Drift[] = [];
for (const boxRoot of await boxPaths()) {
  try {
    const drift = await inspect(boxRoot);
    if (drift) drifted.push(drift);
  } catch (error) {
    // One unreadable box must not hide the others. Report it as drift of
    // unknown size rather than swallowing it.
    drifted.push({ box: path.basename(boxRoot), pending: [`(unreadable: ${errnoCode(error) ?? "error"})`], dirty: false, where: "local" });
  }
}

const prod = await prodDrift();
if (prod !== null) drifted.push(...prod);

if (drifted.length === 0 && prod !== null) process.exit(0);

function describe(d: Drift): string[] {
  const shown = d.pending.slice(0, 8).join(", ");
  const more = d.pending.length > 8 ? `, +${String(d.pending.length - 8)} more` : "";
  // A PROD box that is both behind and dirty is the starvation case: the deploy
  // sweep skips a dirty tree and promises the next deploy, so the busiest box —
  // the one most likely to be mid-write in any window — can be skipped forever.
  // Naming it is the point; that state went unreported for three days once.
  const fix = d.where === "prod" && d.dirty
    ? "  Deploy sweeps keep skipping this box (dirty tree). It will not converge on its own."
    : d.dirty
      ? "  A dirty box cannot be swept — commit or stash first, then `bbx engine migrate --apply`."
      : "  Fix with `bbx engine migrate --apply` in that box.";
  return [`**${d.box}** (${d.where}) — ${String(d.pending.length)} pending${d.dirty ? ", working tree dirty" : ""}`, `  ${shown}${more}`, fix];
}

const headline = drifted.length === 0
  ? "Production migration state could not be read."
  : `${String(drifted.length)} box(es) behind the shipped migrations.`;
const message = [
  headline,
  "",
  ...drifted.flatMap(describe),
  ...(prod === null
    ? ["", "Production was NOT checked — `beebox/deploy/prod-ssh` failed or is not configured here. The prod half is unknown, not clean."]
    : []),
].join("\n");

const prodBehind = drifted.some((d) => d.where === "prod");
// A prod box behind the shipped code, or a prod half nobody could read, is worth
// more than the daily local-drift note: local drift waits, production does not.
const priority = prodBehind || prod === null ? "important" : "normal";
const title = drifted.length === 0
  ? "Production migration state unreadable"
  : `${String(drifted.length)} box(es) behind on migrations${prodBehind ? " (production)" : ""}`;

if (dryRun || !scheduled) {
  process.stdout.write(`[box-convergence] ${dryRun ? "would report" : "report"} ${String(drifted.length)} drifted box(es)\n${message}\n`);
} else {
  await execa(path.join(REPO_ROOT, "bin", "schedules"), [
    "alert", "--priority", priority, "--title", title, "--message", message,
  ], { stdout: "inherit", stderr: "inherit" });
}
