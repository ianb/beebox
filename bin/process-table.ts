// Reading the machine's process table, for bin/process-cleanup.ts.
//
// Split out of process-cleanup.ts as a pure move: that module is the reclaim
// POLICY (what may be killed and when), and this one is the two system
// commands it reads the world through — `ps` for every process, `lsof` for the
// cwd of the ones whose argv does not say where they live.

import { execa } from "execa";

export interface PsRow {
  pid: number;
  ppid: number;
  ageSec: number;
  command: string;
}

/**
 * Seconds from a `ps etime` field (`[[dd-]hh:]mm:ss`). Returns `Infinity` for
 * anything unparseable: an unreadable age must not read as "young", which is
 * the value that spares a process from an otherwise-correct reap.
 */
export function etimeToSeconds(etime: string): number {
  const m = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return Infinity;
  const [days, hours, mins, secs] = [m[1] ?? "0", m[2] ?? "0", m[3]!, m[4]!].map(Number);
  return ((days! * 24 + hours!) * 60 + mins!) * 60 + secs!;
}

export async function psRows(): Promise<PsRow[]> {
  const { stdout } = await execa("ps", ["-axo", "pid=,ppid=,etime=,command="]);
  const rows: PsRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), ageSec: etimeToSeconds(m[3]!), command: m[4]! });
  }
  return rows;
}

/**
 * The stdout an execa rejection carries, when it carries one. A failed process
 * is not typed as anything in particular, so this is the one place that reads
 * the shape rather than asserting it at the site that needs it.
 */
function execaStdout(error: unknown): string {
  if (typeof error !== "object" || error === null || !("stdout" in error)) return "";
  return typeof error.stdout === "string" ? error.stdout : "";
}

/** cwd of each pid via lsof, best-effort (some pids may be unreadable). */
export async function cwdOf(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (pids.length === 0) return out;
  let stdout = "";
  try {
    ({ stdout } = await execa("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-Fn"]));
  } catch (e) {
    // lsof exits non-zero if *any* listed pid is gone, but still prints the
    // rest on stdout — recover whatever it managed to emit.
    stdout = execaStdout(e);
  }
  let cur = 0;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) cur = Number(line.slice(1));
    else if (line.startsWith("n") && cur) out.set(cur, line.slice(1));
  }
  return out;
}
