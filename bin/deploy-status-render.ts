/**
 * Plain-text rendering for `bin/deploy-status`: one labeled line (or two) per
 * section, a degraded section shown as `unavailable: <reason>`. Pure; `now`
 * is passed in so relative times are testable.
 */

import type {
  CommitsReport,
  DeployRecord,
  DeployStatusReport,
  Divergence,
  HealthReport,
  LockState,
  MigrationStatus,
  Section,
} from "./deploy-status-lib.js";
import { describeServices } from "./deploy-status-lib.js";
import type { DiskHealth } from "../beebox/src/hub/disk-health.js";
import { assertNever } from "../beebox/src/shared/invariant.js";

const LABEL_WIDTH = 11;

function line(label: string, text: string): string {
  return `${label.padEnd(LABEL_WIDTH)}${text}`;
}

function continuation(text: string): string {
  return `${" ".repeat(LABEL_WIDTH)}${text}`;
}

export function ago(iso: string | null, now: Date): string {
  if (iso === null) return "";
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return " (just now)";
  if (minutes < 120) return ` (${String(minutes)}m ago)`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return ` (${String(hours)}h ago)`;
  return ` (${String(Math.round(hours / 24))}d ago)`;
}

/** "main is 3 ahead of prod", "even with prod", "2 ahead, 1 behind prod". */
export function describeDivergence(name: string, divergence: Section<Divergence>): string {
  if (!divergence.ok) return `${name}: ${divergence.reason}`;
  const { prodOnly, localOnly } = divergence.data;
  if (prodOnly === 0 && localOnly === 0) return `${name} = prod`;
  if (prodOnly === 0) return `${name} ${String(localOnly)} ahead of prod`;
  if (localOnly === 0) return `${name} ${String(prodOnly)} behind prod`;
  return `${name} ${String(localOnly)} ahead, ${String(prodOnly)} behind prod`;
}

function renderCommits(commits: CommitsReport, now: Date): string[] {
  const source = commits.source === "server" ? "" : " [server unreachable; local success marker]";
  const subject = commits.subject === null ? "" : ` ${commits.subject}`;
  const when = commits.deployedAt === null ? "" : ` · at ${commits.deployedAt}${ago(commits.deployedAt, now)}`;
  return [
    line("Deployed", `${commits.deployedSha.slice(0, 9)}${subject}${when}${source}`),
    continuation(
      `${describeDivergence("main", commits.main)} · ${describeDivergence(`HEAD (${commits.head.ref})`, commits.head.divergence)}`,
    ),
  ];
}

function renderLastDeploy(record: DeployRecord, now: Date): string {
  const down = record.downSeconds === null ? "" : `, down ${String(record.downSeconds)}s`;
  const exit = record.outcome === "ok" ? "" : ` (exit ${String(record.exit)})`;
  return line(
    "Last run",
    `${record.outcome}${exit} · ${record.sha.slice(0, 9)} · ${record.startedAt} → ${record.endedAt}${ago(record.endedAt, now)}${down}`,
  );
}

export function renderLock(lock: LockState): string[] {
  switch (lock.state) {
    case "free":
      return [line("Lock", "free — no deploy in progress")];
    case "stale":
      return [line("Lock", `stale — lock dir left by pid ${lock.pid === null ? "unknown" : String(lock.pid)}, which is gone; the next deploy breaks it`)];
    case "held": {
      const since = lock.since === null ? "" : ` since ${lock.since}`;
      const out = [line("Lock", `HELD — deploy in progress (pid ${String(lock.pid)}${since})`)];
      if (lock.logTail !== null) out.push(continuation(`log: ${lock.logTail}`));
      return out;
    }
    default:
      return assertNever(lock);
  }
}

function renderHealth(health: HealthReport): string[] {
  const broken = health.boxes.filter((box) => box.status === "unhealthy" || (box.status === "starting" && box.consecutiveFailures > 0));
  const running = health.boxes.filter((box) => box.status === "running").length;
  const counts = `${String(health.boxes.length)} boxes (${String(running)} running, ${String(broken.length)} broken)`;
  const out = [line("Health", `hub ${health.verdict} (HTTP ${String(health.code)}) · ${counts}`)];
  out.push(continuation(`services: ${describeServices(health.services)}`));
  if (broken.length > 0) out.push(continuation(`broken: ${broken.map((box) => `${box.slug} ${box.status}`).join(", ")}`));
  return out;
}

function renderDisk(disk: DiskHealth): string {
  const flag = disk.status === "ok" ? "ok" : "LOW — tell the boxholder";
  return line("Disk", `${disk.freeGiB.toFixed(1)} GiB free on / (threshold ${disk.thresholdGiB.toFixed(1)} GiB) · ${flag}`);
}

function renderMigrations(boxes: MigrationStatus[]): string[] {
  if (boxes.length === 0) return [line("Migrations", "no boxes found under /home/beebox/boxes")];
  const attention = boxes.filter((box) => !box.status.ok || box.status.data.pending.length > 0 || box.status.data.questions.length > 0 || !box.status.data.manifest);
  if (attention.length === 0) return [line("Migrations", `${String(boxes.length)} boxes, none pending`)];
  const out = [line("Migrations", `${String(boxes.length)} boxes, ${String(attention.length)} need attention`)];
  for (const box of attention) {
    if (!box.status.ok) {
      out.push(continuation(`${box.box}: unavailable: ${box.status.reason}`));
      continue;
    }
    const { manifest, pending, questions } = box.status.data;
    const parts: string[] = [];
    if (!manifest) parts.push("no migration manifest");
    if (pending.length > 0) parts.push(`pending ${pending.join(", ")}`);
    if (questions.length > 0) parts.push(`${String(questions.length)} open question(s)`);
    out.push(continuation(`${box.box}: ${parts.join("; ")}`));
  }
  return out;
}

function sectionLines<T>(args: { label: string; section: Section<T>; render: (data: T) => string[] }): string[] {
  if (!args.section.ok) return [line(args.label, `unavailable: ${args.section.reason}`)];
  return args.render(args.section.data);
}

export function renderText(report: DeployStatusReport, now: Date): string {
  return [
    ...sectionLines({ label: "Deployed", section: report.commits, render: (data) => renderCommits(data, now) }),
    ...sectionLines({ label: "Last run", section: report.lastDeploy, render: (data) => [renderLastDeploy(data, now)] }),
    ...sectionLines({ label: "Lock", section: report.lock, render: renderLock }),
    ...sectionLines({ label: "Health", section: report.health, render: renderHealth }),
    ...sectionLines({ label: "Disk", section: report.disk, render: (data) => [renderDisk(data)] }),
    ...sectionLines({ label: "Migrations", section: report.migrations, render: renderMigrations }),
  ].join("\n");
}
