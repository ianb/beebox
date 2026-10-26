/**
 * The unit-host half of the host audit: on a host where each box runs as its
 * own Linux user (`bbx-<slug>`, home `/var/lib/beebox/<slug>`), isolation is
 * enforced by file modes and ownership. These checks read the layout that
 * `beebox/docs/implemented-plans/per-box-units.md` specifies and report any deviation.
 *
 * Same constraint as `host-audit.ts`: no import from `beebox/src/**`, and no
 * native dependency (users and groups come from `/etc/passwd` and
 * `/etc/group` read as text).
 */

import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";

import type { BoxRoot, HostFinding } from "./host-audit.js";

export const UNIT_HOME_ROOT = "/var/lib/beebox";
const HUB_USER = "beebox";
const HUB_SECRET_DIR = "/run/beebox";
const BOX_ENV_FILE = "/etc/beebox/box.env";
const HUB_META = "hub-meta.json";

export interface UnitAuditOptions {
  /** Text of `/etc/passwd`; read from disk when omitted. */
  passwd?: string;
  /** Text of `/etc/group`; read from disk when omitted. */
  group?: string;
  /** Parent of the per-box homes. */
  homeRoot?: string;
  /** Directory holding `<slug>.hub-secret`. */
  hubSecretDir?: string;
  /** Receives skip notes (e.g. an absent hub secret); never a finding. */
  debug?: (message: string) => void;
}

interface IdTable {
  users: Map<string, { uid: number; gid: number }>;
  groups: Map<string, number>;
}

function parseIds(passwd: string, group: string): IdTable {
  const users = new Map<string, { uid: number; gid: number }>();
  const groups = new Map<string, number>();
  for (const line of passwd.split("\n")) {
    const [name, , uid, gid] = line.split(":");
    if (name !== undefined && uid !== undefined && gid !== undefined && /^\d+$/u.test(uid) && /^\d+$/u.test(gid)) {
      users.set(name, { uid: Number(uid), gid: Number(gid) });
    }
  }
  for (const line of group.split("\n")) {
    const [name, , gid] = line.split(":");
    if (name !== undefined && gid !== undefined && /^\d+$/u.test(gid)) groups.set(name, Number(gid));
  }
  return { users, groups };
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (_e) {
    return "";
  }
}

async function lstatOrNull(target: string): Promise<Stats | null> {
  try {
    return await fs.lstat(target);
  } catch (_e) {
    return null;
  }
}

/**
 * A directory's entries, or the reason they could not be listed. The box
 * homes are 0751, so an audit run as a user other than root or the box's
 * owner cannot list them; that is reported, never read as "nothing to check"
 * (cross-model review, codex gpt-6-sol, 2026-10-24).
 */
async function entryNames(dir: string): Promise<{ names: string[]; unreadable?: string }> {
  try {
    return { names: await fs.readdir(dir) };
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String(e.code) : "error";
    if (code === "ENOENT") return { names: [] };
    return { names: [], unreadable: `cannot list (${code}); run the audit as root on a unit host` };
  }
}

function octal(stat: Stats): string {
  return (stat.mode & 0o777).toString(8).padStart(4, "0");
}

/** The slug of a `<homeRoot>/<slug>/box` root, or null for any other path. */
function unitSlug(root: string, homeRoot: string): string | null {
  const rel = path.relative(homeRoot, path.resolve(root)).split(path.sep);
  return rel.length === 2 && rel[1] === "box" && rel[0] !== "" && rel[0] !== ".." ? (rel[0] ?? null) : null;
}

export function isUnitHost(boxes: BoxRoot[], homeRoot?: string): boolean {
  const base = homeRoot ?? UNIT_HOME_ROOT;
  return boxes.some((b) => unitSlug(b.root, base) !== null);
}

async function checkDirLayout(dir: string, owner: { slug: string; ids: IdTable }): Promise<HostFinding[]> {
  const stat = await lstatOrNull(dir);
  if (stat === null) return [{ path: dir, message: "missing" }];
  const { slug, ids } = owner;
  const findings: HostFinding[] = [];
  if ((stat.mode & 0o777) !== 0o751) findings.push({ path: dir, message: `mode ${octal(stat)}, expected 0751` });
  const user = ids.users.get(`bbx-${slug}`);
  const gid = ids.groups.get(`bbx-${slug}`);
  if (user === undefined || gid === undefined) {
    findings.push({ path: dir, message: `no user or group bbx-${slug} in the passwd database` });
  } else if (stat.uid !== user.uid || stat.gid !== gid) {
    findings.push({ path: dir, message: `owned by ${stat.uid}:${stat.gid}, expected bbx-${slug} (${user.uid}:${gid})` });
  }
  return findings;
}

/** Direct entries of `dir` (other than `skip`) must be owner-only. */
async function checkPrivateEntries(dir: string, skip: string): Promise<HostFinding[]> {
  const findings: HostFinding[] = [];
  const listing = await entryNames(dir);
  if (listing.unreadable !== undefined) return [{ path: dir, message: listing.unreadable }];
  for (const name of listing.names) {
    if (name === skip) continue;
    const full = path.join(dir, name);
    const stat = await lstatOrNull(full);
    // A symlink's own mode is meaningless on Linux; access follows the target.
    if (stat === null || stat.isSymbolicLink()) continue;
    if ((stat.mode & 0o077) !== 0) {
      const expected = stat.isDirectory() ? "0700" : "0600";
      findings.push({ path: full, message: `mode ${octal(stat)}, expected ${expected} (group/other accessible)` });
    }
  }
  return findings;
}

async function checkBeeboxDir(dir: string): Promise<HostFinding[]> {
  const findings: HostFinding[] = [];
  const walk = async (current: string): Promise<void> => {
    const listing = await entryNames(current);
    if (listing.unreadable !== undefined) {
      findings.push({ path: current, message: listing.unreadable });
      return;
    }
    for (const name of listing.names) {
      const full = path.join(current, name);
      const stat = await lstatOrNull(full);
      if (stat === null || stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await walk(full);
      } else if (full === path.join(dir, HUB_META)) {
        if ((stat.mode & 0o777) !== 0o644) findings.push({ path: full, message: `mode ${octal(stat)}, expected 0644` });
      } else if ((stat.mode & 0o044) !== 0) {
        findings.push({ path: full, message: `mode ${octal(stat)}, group/other readable; only ${HUB_META} may be` });
      }
    }
  };
  await walk(dir);
  return findings;
}

async function checkHubSecret(slug: string, ctx: { ids: IdTable; opts: UnitAuditOptions }): Promise<HostFinding[]> {
  const { ids, opts } = ctx;
  const file = path.join(opts.hubSecretDir ?? HUB_SECRET_DIR, `${slug}.hub-secret`);
  const stat = await lstatOrNull(file);
  if (stat === null) {
    opts.debug?.(`${file} absent; the hub has not run yet`);
    return [];
  }
  const findings: HostFinding[] = [];
  if ((stat.mode & 0o777) !== 0o600) findings.push({ path: file, message: `mode ${octal(stat)}, expected 0600` });
  const hub = ids.users.get(HUB_USER);
  if (hub === undefined) {
    findings.push({ path: file, message: `no user ${HUB_USER} in the passwd database` });
  } else if (stat.uid !== hub.uid) {
    findings.push({ path: file, message: `owned by uid ${stat.uid}, expected ${HUB_USER} (${hub.uid})` });
  }
  return findings;
}

/** Layout, modes, ownership and hub-secret checks for every unit-host box. */
export async function checkBoxUserLayout(boxes: BoxRoot[], options?: UnitAuditOptions): Promise<HostFinding[]> {
  const opts = options ?? {};
  const homeRoot = opts.homeRoot ?? UNIT_HOME_ROOT;
  const ids = parseIds(opts.passwd ?? (await readText("/etc/passwd")), opts.group ?? (await readText("/etc/group")));
  const findings: HostFinding[] = [];
  for (const box of boxes) {
    const slug = unitSlug(box.root, homeRoot);
    if (slug === null) continue;
    const home = path.join(homeRoot, slug);
    const root = path.join(home, "box");
    const owner = { slug, ids };
    findings.push(
      ...(await checkDirLayout(home, owner)),
      ...(await checkDirLayout(root, owner)),
      ...(await checkDirLayout(path.join(root, ".beebox"), owner)),
      ...(await checkPrivateEntries(home, "box")),
      ...(await checkPrivateEntries(root, ".beebox")),
      ...(await checkBeeboxDir(path.join(root, ".beebox"))),
      ...(await checkHubSecret(slug, { ids, opts })),
    );
  }
  return findings;
}

// The keys the plan accepts reaching every box: the host's push identities,
// and the shared read-only diagnostic bearer the child env allowlist passes
// (beebox/src/hub/supervisor/child-env.ts).
const ALLOWED_SECRET_NAMES = /^(?:BBX_VAPID_PUBLIC_KEY|BBX_VAPID_PRIVATE_KEY|BBX_APNS_KEY_\w+|BBX_DIAG_API_KEY)$/u;
const FORBIDDEN_NAME = /^(?:BBX_SESSION_SECRET|BBX_HUB_SECRET|\w*_SECRET|\w*_KEY)$/u;

/** `box.env` is read by every box's service; it must not carry hub or session secrets. */
export async function checkBoxEnvSecrets(envFile?: string): Promise<HostFinding[]> {
  const file = envFile ?? BOX_ENV_FILE;
  const findings: HostFinding[] = [];
  const lines = (await readText(file)).split("\n");
  for (const [index, raw] of lines.entries()) {
    const match = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/u.exec(raw);
    const name = match?.[1];
    if (name === undefined || ALLOWED_SECRET_NAMES.test(name) || !FORBIDDEN_NAME.test(name)) continue;
    findings.push({ path: file, message: `line ${index + 1}: ${name} must not be in the shared box environment` });
  }
  return findings;
}
