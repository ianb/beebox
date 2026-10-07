/**
 * Pure half of `bin/deploy-status`: the report shape and the parsers that turn
 * git, local marker files, and one SSH transcript into it. No I/O here, so
 * `bin/deploy-status.test.ts` drives every branch from fixture strings.
 *
 * Each section is a `Section<T>`: data, or a one-line reason it is missing.
 * A failure in one never hides another — "no SSH" degrades the remote
 * sections and still reports the local lock and last deploy record.
 */

import { isRecord } from "../beebox/src/shared/is-record.js";
import { diskHealthFromBytes, type DiskHealth } from "../beebox/src/hub/disk-health.js";

export type Section<T> = { ok: true; data: T } | { ok: false; reason: string };

export function available<T>(data: T): Section<T> {
  return { ok: true, data };
}

export function degraded<T>(reason: string): Section<T> {
  return { ok: false, reason };
}

/** `git rev-list --left-right --count prod...local`: commits only on prod, and only on the local ref. */
export interface Divergence { prodOnly: number; localOnly: number }

export interface CommitsReport {
  /** Where the deployed sha came from: the server's deploy-info.json, or the local success marker. */
  source: "server" | "local-marker";
  deployedSha: string;
  subject: string | null;
  deployedAt: string | null;
  /** prod...main: `localOnly` is main's commits not yet live; degraded when the sha is not in local history. */
  main: Section<Divergence>;
  /** prod...HEAD of the invoking checkout; `ref` is its branch name or "HEAD" when detached. */
  head: { ref: string; divergence: Section<Divergence> };
}

export interface DeployRecord {
  startedAt: string;
  endedAt: string;
  sha: string;
  outcome: string;
  exit: number;
  downSeconds: number | null;
}

export type LockState =
  | { state: "free"; requestedSha: string | null }
  | { state: "held"; pid: number; alive: true; since: string | null; logTail: string | null }
  | { state: "stale"; pid: number | null };

export interface BoxHealth { slug: string; status: string; consecutiveFailures: number }

export interface HealthReport {
  /** HTTP status of the hub's passive /healthz. */
  code: number;
  verdict: string;
  boxes: BoxHealth[];
  services: Record<string, string>;
}

export interface MigrationStatus { box: string; status: Section<{ manifest: boolean; pending: string[]; questions: string[] }> }

export interface DeployStatusReport {
  commits: Section<CommitsReport>;
  lastDeploy: Section<DeployRecord>;
  lock: Section<LockState>;
  health: Section<HealthReport>;
  disk: Section<DiskHealth>;
  migrations: Section<MigrationStatus[]>;
}

/** `git rev-list --left-right --count a...b` prints `<left>\t<right>`. */
export function parseDivergence(output: string): Divergence | null {
  const match = /^(\d+)\s+(\d+)$/.exec(output.trim());
  if (!match) return null;
  return { prodOnly: Number(match[1]), localOnly: Number(match[2]) };
}

/** The last parseable line of deploy.sh's `.deploy-logs/deploys.jsonl`. */
export function parseLastDeployRecord(jsonl: string): DeployRecord | null {
  const lines = jsonl.split("\n").filter((line) => line.trim() !== "");
  for (const line of lines.toReversed()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (_e) {
      continue; // a torn final write; the previous line is still a real record
    }
    if (!isRecord(parsed)) continue;
    const { startedAt, endedAt, sha, outcome, exit, downSeconds } = parsed;
    if (typeof startedAt !== "string" || typeof endedAt !== "string" || typeof sha !== "string") continue;
    if (typeof outcome !== "string" || typeof exit !== "number") continue;
    return { startedAt, endedAt, sha, outcome, exit, downSeconds: typeof downSeconds === "number" ? downSeconds : null };
  }
  return null;
}

/** The server's `/opt/beebox/beebox/deploy-info.json`. */
export function parseDeployInfo(text: string): { hash: string; subject: string | null; deployedAt: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    return null; // reported by the caller as "unparseable"
  }
  if (!isRecord(parsed) || !isRecord(parsed.commits) || !isRecord(parsed.commits.beebox)) return null;
  const { hash, subject } = parsed.commits.beebox;
  if (typeof hash !== "string" || hash === "") return null;
  return {
    hash,
    subject: typeof subject === "string" ? subject : null,
    deployedAt: typeof parsed.deployedAt === "string" ? parsed.deployedAt : null,
  };
}

/** `df -Pk /`: the last line's total and available 1K-blocks. */
export function parseDf(text: string): DiskHealth | null {
  const fields = text.trim().split("\n").at(-1)?.trim().split(/\s+/);
  const totalKib = Number(fields?.[1]);
  const freeKib = Number(fields?.[3]);
  if (!Number.isFinite(totalKib) || !Number.isFinite(freeKib) || totalKib <= 0) return null;
  return diskHealthFromBytes(freeKib * 1024, totalKib * 1024);
}

/** The body + trailing status-code line `curl -w '\n%{http_code}'` prints, plus `systemctl is-active` lines. */
export function parseHealth(args: { healthz: string; services: string }): Section<HealthReport> {
  const lines = args.healthz.trimEnd().split("\n");
  const code = Number(lines.pop());
  const body = lines.join("\n");
  const unitNames = ["beebox-hub", "beebox-scheduler"];
  const states = args.services.trim().split("\n");
  const services = Object.fromEntries(unitNames.map((unit, i) => [unit, states[i]?.trim() ?? "unknown"]));
  if (!Number.isFinite(code) || code === 0) return degraded(`hub /healthz did not answer (services: ${describeServices(services)})`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (_e) {
    return degraded(`hub /healthz returned HTTP ${String(code)} with a non-JSON body`);
  }
  if (!isRecord(parsed) || typeof parsed.status !== "string") {
    return degraded(`hub /healthz returned HTTP ${String(code)} without a verdict`);
  }
  const boxes: BoxHealth[] = [];
  for (const box of Array.isArray(parsed.boxes) ? parsed.boxes : []) {
    if (!isRecord(box) || typeof box.slug !== "string" || typeof box.status !== "string") continue;
    boxes.push({
      slug: box.slug,
      status: box.status,
      consecutiveFailures: typeof box.consecutiveFailures === "number" ? box.consecutiveFailures : 0,
    });
  }
  return available({ code, verdict: parsed.status, boxes, services });
}

export function describeServices(services: Record<string, string>): string {
  return Object.entries(services).map(([unit, state]) => `${unit} ${state}`).join(", ");
}

/** The migrations section: `@@box <slug>` headers, each followed by output lines and `@@rc <n>`. */
export function parseMigrations(text: string): MigrationStatus[] {
  const results: MigrationStatus[] = [];
  let current: { box: string; lines: string[] } | null = null;
  const finish = (rc: number): void => {
    if (current === null) return;
    results.push({ box: current.box, status: migrationStatus(current.lines, rc) });
    current = null;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("@@box ")) {
      finish(-1);
      current = { box: line.slice("@@box ".length).trim(), lines: [] };
    } else if (line.startsWith("@@rc ")) {
      finish(Number(line.slice("@@rc ".length)));
    } else if (current !== null && line.trim() !== "") {
      current.lines.push(line);
    }
  }
  finish(-1);
  return results;
}

function migrationStatus(lines: string[], rc: number): MigrationStatus["status"] {
  const json = lines.findLast((line) => line.trimStart().startsWith("{"));
  if (json !== undefined) {
    try {
      const parsed: unknown = JSON.parse(json);
      if (isRecord(parsed) && Array.isArray(parsed.pending)) {
        return available({
          manifest: parsed.manifest === true,
          pending: parsed.pending.filter((name): name is string => typeof name === "string"),
          questions: Array.isArray(parsed.questions)
            ? parsed.questions.filter((name): name is string => typeof name === "string")
            : [],
        });
      }
    } catch (_e) {
      // falls through to the exit-code reason below
    }
  }
  const last = lines.at(-1)?.trim();
  const why = rc === 124 ? "timed out" : rc < 0 ? "no exit status" : `exit ${String(rc)}`;
  return degraded(`bbx engine migrate --status --json: ${why}${last === undefined ? "" : ` (${last.slice(0, 160)})`}`);
}

/**
 * Split the one SSH transcript into sections. The remote script prints
 * `@@section <name>` before each and `@@error <reason>` inside one that could
 * not be read, so a missing or failed section is told apart from an empty one.
 */
export function splitSections(transcript: string): Map<string, Section<string>> {
  const sections = new Map<string, Section<string>>();
  let name: string | null = null;
  let body: string[] = [];
  let error: string | null = null;
  const close = (): void => {
    if (name !== null) sections.set(name, error === null ? available(body.join("\n")) : degraded(error));
  };
  for (const line of transcript.split("\n")) {
    if (line.startsWith("@@section ")) {
      close();
      name = line.slice("@@section ".length).trim();
      body = [];
      error = null;
    } else if (line.startsWith("@@error ") && error === null) {
      error = line.slice("@@error ".length).trim();
    } else {
      body.push(line);
    }
  }
  close();
  return sections;
}

/** A sections map lookup that names what was missing. */
export function section(sections: Map<string, Section<string>>, name: string): Section<string> {
  return sections.get(name) ?? degraded(`the server sent no ${name} section (remote script cut short)`);
}
