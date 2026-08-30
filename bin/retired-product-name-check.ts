#!/usr/bin/env node --import tsx
/**
 * Tracked-tree checker for the retired product vocabulary.
 *
 * The checker starts in inventory-only mode. Set ENFORCEMENT_ENABLED to true
 * when the rename reaches its reviewed baseline. `--inventory` remains useful
 * in either mode and reports counts by class, subtree, and extension.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

export const ENFORCEMENT_ENABLED = true;
export const CHECKER_PATH = "bin/retired-product-name-check.ts";
export const ALLOWLIST_PATH = "bin/retired-product-name-allowlist.json";

export const OCCURRENCE_CLASSES = [
  "display-name",
  "compact-name",
  "kebab-name",
  "derivative-clerk-name",
  "snake-name",
  "cb-prefix",
  "callback-prefix",
  "dot-state-directory",
  "config-cli-directory",
  "header-prefix",
  "session-key",
  "old-domain",
  "old-service",
  "old-home",
  "old-account",
  "standalone-cli-token",
  "path-display-name",
  "path-compact-name",
  "path-kebab-name",
  "path-derivative-clerk-name",
  "path-snake-name",
  "path-dot-state-directory",
  "path-config-cli-directory",
  "path-cli-segment",
] as const;

export type OccurrenceClass = (typeof OCCURRENCE_CLASSES)[number];

export interface Finding { path: string; line: number; occurrenceClass: OccurrenceClass; match: string }

export interface AllowlistEntry { path: string; occurrenceClass: OccurrenceClass; expectedCount: number; reason: string }

interface Pattern {
  occurrenceClass: OccurrenceClass;
  regex: RegExp;
}

interface Candidate { start: number; end: number; priority: number; occurrenceClass: OccurrenceClass; match: string }

// Keep the specialized forms before their broader forms. `chooseMatches()`
// then emits one named class for an occurrence instead of double-counting a
// header, state directory, or old hostname as a generic token too.
const CONTENT_PATTERNS: Pattern[] = [
  { occurrenceClass: "old-domain", regex: /callback-box\.zulipchat\.com|cb\.ianbicking\.org/gi },
  { occurrenceClass: "old-service", regex: /com\.callback(?:[.-][\da-z-]+)*|callback-(?:deploy|hub|serve|scheduler)/gi },
  { occurrenceClass: "old-home", regex: /\/(?:home|opt)\/callback\b/gi },
  { occurrenceClass: "old-account", regex: /(?:User|Group)=callback\b|(?:sudo -u|su -) callback\b|callback:callback\b/g },
  { occurrenceClass: "dot-state-directory", regex: /\.callback-box\b|\.cb-(?:auth|box|browser-profile|session-secret)\b/gi },
  { occurrenceClass: "config-cli-directory", regex: /\.(?:config|cache)\/cb\b|\.local\/share\/cb\b/gi },
  { occurrenceClass: "header-prefix", regex: /\bx-cb-[\da-z-]+/gi },
  { occurrenceClass: "session-key", regex: /\bcb_session\b/gi },
  { occurrenceClass: "cb-prefix", regex: /\bCB_[\dA-Z][\dA-Z_]*\b/g },
  { occurrenceClass: "callback-prefix", regex: /\bCALLBACK_[\dA-Z][\dA-Z_]*\b/g },
  { occurrenceClass: "display-name", regex: /callback box/gi },
  { occurrenceClass: "derivative-clerk-name", regex: /callback clerk|callback-clerk/gi },
  { occurrenceClass: "compact-name", regex: /callbackbox/gi },
  { occurrenceClass: "kebab-name", regex: /callback-box/gi },
  { occurrenceClass: "snake-name", regex: /callback_box/gi },
  {
    occurrenceClass: "standalone-cli-token",
    // A two-letter token is also common as a callback parameter.  Require a
    // command context (a shell line, a command substitution, a quoted command,
    // or an explicit invocation word) before matching an arbitrary
    // command-shaped lowercase word. This deliberately has no product-command
    // allowlist: a newly added `bbx` verb must make an old `cb verb` fail the
    // tripwire immediately.
    regex:
      /(?:^|\\n)\s*cb(?=\s+[a-z][\da-z-]*\b)|(?:\$\(\s*|\.name\(["']|["'`]|\bpnpm\s+|\bcommand\s+-v\s+|\/bin\/|\/usr\/local\/bin\/|\b(?:run|exec|invoke|using|via|call)\s+)\bcb\b(?:["'`]|(?=\s+[a-z][\da-z-]*\b))|\bcb(?:Bin|Binary|Path)\b/g,
  },
];

const PATH_PATTERNS: Pattern[] = [
  { occurrenceClass: "path-dot-state-directory", regex: /(?:^|\/)\.callback-box(?:\/|$)/gi },
  { occurrenceClass: "path-config-cli-directory", regex: /(?:^|\/)\.config\/cb(?:\/|$)/gi },
  { occurrenceClass: "path-display-name", regex: /(?:^|\/)callback box(?:\/|$)/gi },
  { occurrenceClass: "path-compact-name", regex: /(?:^|\/)callbackbox(?:\/|$)/gi },
  { occurrenceClass: "path-kebab-name", regex: /(?:^|\/)callback-box(?:\/|$)/gi },
  { occurrenceClass: "path-derivative-clerk-name", regex: /(?:^|\/)callback-clerk(?:\/|$)/gi },
  { occurrenceClass: "path-snake-name", regex: /(?:^|\/)callback_box(?:\/|$)/gi },
  { occurrenceClass: "path-cli-segment", regex: /(?:^|\/)cb(?:\/|$)/gi },
];

function chooseMatches(text: string, patterns: Pattern[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [priority, pattern] of patterns.entries()) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      const value = match[0];
      const start = match.index;
      if (value === undefined || start === undefined) continue;
      candidates.push({
        start,
        end: start + value.length,
        priority,
        occurrenceClass: pattern.occurrenceClass,
        match: value,
      });
    }
  }

  const sortedCandidates = candidates.toSorted((a, b) => a.start - b.start || a.priority - b.priority || b.end - a.end);
  const chosen: Candidate[] = [];
  for (const candidate of sortedCandidates) {
    const overlaps = chosen.some((previous) => candidate.start < previous.end && previous.start < candidate.end);
    if (!overlaps) chosen.push(candidate);
  }
  return chosen;
}

/** Scan one content line. This is pure and deliberately independent of git. */
export function findContentMatches(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    for (const match of chooseMatches(line, CONTENT_PATTERNS)) {
      findings.push({
        path,
        line: index + 1,
        occurrenceClass: match.occurrenceClass,
        match: match.match,
      });
    }
  }
  return findings;
}

/** Scan one tracked path. Each matching path occurrence has line 0. */
export function findPathMatches(path: string): Finding[] {
  return chooseMatches(path, PATH_PATTERNS).map((match) => ({
    path,
    line: 0,
    occurrenceClass: match.occurrenceClass,
    match: match.match,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOccurrenceClass(value: unknown): value is OccurrenceClass {
  const classes: readonly string[] = OCCURRENCE_CLASSES;
  return typeof value === "string" && classes.includes(value);
}

function asAllowlistEntries(value: unknown): AllowlistEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is AllowlistEntry => {
    if (!isRecord(entry)) return false;
    return (
      typeof entry.path === "string" &&
      isOccurrenceClass(entry.occurrenceClass) &&
      typeof entry.expectedCount === "number" &&
      typeof entry.reason === "string"
    );
  });
}

export function validateAllowlist(entries: unknown): string[] {
  if (!Array.isArray(entries)) return ["allowlist must be an array"];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of entries.entries()) {
    if (!isRecord(value) || Array.isArray(value)) {
      errors.push(`allowlist entry ${index + 1} must be an object`);
      continue;
    }
    const record = value;
    const keys = Object.keys(record).toSorted().join(",");
    if (keys !== "expectedCount,occurrenceClass,path,reason") {
      errors.push(`allowlist entry ${index + 1} must have exactly path, occurrenceClass, expectedCount, reason`);
    }
    const path = record.path;
    const occurrenceClass = record.occurrenceClass;
    const expectedCount = record.expectedCount;
    const reason = record.reason;
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      path.startsWith("/") ||
      path.endsWith("/") ||
      [...path].some((character) => "*?[]{}".includes(character)) ||
      path.includes("\\")
    ) {
      errors.push(`allowlist entry ${index + 1} has an invalid path`);
    }
    if (!isOccurrenceClass(occurrenceClass)) {
      errors.push(`allowlist entry ${index + 1} has an invalid occurrenceClass`);
    }
    if (typeof expectedCount !== "number" || !Number.isInteger(expectedCount) || expectedCount < 1) {
      errors.push(`allowlist entry ${index + 1} expectedCount must be a positive integer`);
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      errors.push(`allowlist entry ${index + 1} has an empty reason`);
    }
    if (typeof path === "string" && typeof occurrenceClass === "string") {
      const key = `${path}\0${occurrenceClass}`;
      if (seen.has(key)) errors.push(`allowlist entry ${index + 1} duplicates ${path} (${occurrenceClass})`);
      seen.add(key);
    }
  }
  return errors;
}

function countByFinding(findings: Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const key = `${finding.path}\0${finding.occurrenceClass}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface AllowlistCheck {
  violations: Finding[];
  staleEntries: string[];
}

export function checkAllowlist(findings: Finding[], entries: AllowlistEntry[]): AllowlistCheck {
  const counts = countByFinding(findings);
  const allowed = new Map(entries.map((entry) => [`${entry.path}\0${entry.occurrenceClass}`, entry]));
  const violations = findings.filter((finding) => !allowed.has(`${finding.path}\0${finding.occurrenceClass}`));
  const staleEntries: string[] = [];
  for (const entry of entries) {
    const key = `${entry.path}\0${entry.occurrenceClass}`;
    const actual = counts.get(key) ?? 0;
    if (actual !== entry.expectedCount) {
      staleEntries.push(
        `${entry.path} (${entry.occurrenceClass}) expected ${entry.expectedCount}, found ${actual}: ${entry.reason}`,
      );
    }
  }
  return { violations, staleEntries };
}

function extensionFor(path: string): string {
  const extension = extname(path);
  return extension === "" ? "(none)" : extension;
}

function topLevelFor(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
}

function groupedCounts(findings: Finding[], keyFor: (finding: Finding) => string): string[] {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(keyFor(finding), (counts.get(keyFor(finding)) ?? 0) + 1);
  return [...counts.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([key, count]) => `  ${key}: ${count}`);
}

export function formatInventory(findings: Finding[]): string {
  return [
    "Retired product-name inventory",
    "By occurrence class:",
    ...groupedCounts(findings, (finding) => finding.occurrenceClass),
    "By top-level subtree:",
    ...groupedCounts(findings, (finding) => topLevelFor(finding.path)),
    "By extension:",
    ...groupedCounts(findings, (finding) => extensionFor(finding.path)),
  ].join("\n");
}

function exitStatusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

class UsageError extends Error {
  constructor() { super("usage: retired-product-name-check [--inventory] [--enforce]"); this.name = "UsageError"; }
}

function trackedPaths(repoRoot: string): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  return output.split("\0").filter((path) => path !== "");
}

export function scanTrackedTree(repoRoot: string): Finding[] {
  const findings: Finding[] = [];
  for (const path of trackedPaths(repoRoot)) {
    // The checker and its manifest necessarily contain the vocabulary they
    // describe. They are validated structurally below, not hidden by a broad
    // directory exception.
    if (path === CHECKER_PATH || path === ALLOWLIST_PATH) continue;
    findings.push(...findPathMatches(path));
    let content: Buffer;
    try {
      content = readFileSync(join(repoRoot, path));
    } catch (error) {
      if (exitStatusOf(error) === 1) continue;
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    if (content.includes(0)) continue;
    findings.push(...findContentMatches(path, content.toString("utf8")));
  }
  return findings;
}

function readAllowlist(repoRoot: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, ALLOWLIST_PATH), "utf8"));
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => !["--inventory", "--enforce"].includes(arg))) {
    throw new UsageError();
  }
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const findings = scanTrackedTree(repoRoot);
  if (args.has("--inventory")) {
    process.stdout.write(`${formatInventory(findings)}\n`);
    return;
  }
  if (!(ENFORCEMENT_ENABLED || args.has("--enforce"))) return;

  const rawAllowlist = readAllowlist(repoRoot);
  const shapeErrors = validateAllowlist(rawAllowlist);
  if (shapeErrors.length > 0) {
    console.error("retired-product-name-check invalid allowlist:");
    for (const error of shapeErrors) console.error(`  ${error}`);
    process.exit(1);
  }
  const { violations, staleEntries } = checkAllowlist(findings, asAllowlistEntries(rawAllowlist));
  if (violations.length === 0 && staleEntries.length === 0) return;
  console.error("retired-product-name-check failed:");
  for (const finding of violations) {
    const location = finding.line === 0 ? finding.path : `${finding.path}:${finding.line}`;
    console.error(`  ${location} [${finding.occurrenceClass}] ${JSON.stringify(finding.match)}`);
  }
  for (const stale of staleEntries) console.error(`  stale allowlist entry: ${stale}`);
  process.exit(1);
}

if (process.argv[1] !== undefined && relative(process.cwd(), process.argv[1]) === CHECKER_PATH) main();
