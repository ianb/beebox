#!/usr/bin/env node --import tsx
/**
 * Skill and subagent lint (`node --import tsx bin/skill-lint.ts [--json]
 * [--quiet] [--root <dir>]`): checks every `.claude/skills/<name>/SKILL.md`
 * and `.claude/agents/<name>.md` for the shape Claude Code and the Codex
 * mirror need.
 *
 * Failures: frontmatter that does not parse, a `name` that differs from the
 * directory (or agent file stem), an empty or 1,024-character-plus
 * `description` (Claude Code's limit), a body of 400 lines or more, a skill
 * file nested deeper than one directory (`references/x.md` is fine,
 * `references/x/y.md` is not), a bare `/skill` or `$skill` sigil in prose
 * (an invocation; the repo rule is to name skills without it), and a
 * backticked repo path that does not resolve (git-ignored paths are runtime
 * artifacts and pass).
 *
 * Information only: frontmatter keys the Codex skill mirror ignores. `--quiet`
 * drops these; the pre-commit hook uses it.
 *
 * One line per finding; exit 1 when any failure is found, 0 otherwise.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

type Severity = "error" | "info";

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  rule: string;
  message: string;
}

const DESCRIPTION_LIMIT = 1024;
const BODY_LINE_LIMIT = 400;
const CODEX_IGNORED_KEYS = ["allowed-tools", "context", "agent", "background", "hooks", "paths"];
// `/name` or `$name` not inside a path, URL, or longer word.
const SIGIL = /(^|[^\w$./~-])([$/])([a-z][\da-z-]*)(?![\w/-])/g;
const PATH_PREFIXES = ["bin/", "beebox/", "docs/", "src/", ".claude/"];

interface ParsedDoc {
  frontmatter: Record<string, unknown> | undefined;
  body: string;
  /** 1-based line number of the first body line. */
  bodyStart: number;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDoc(text: string): ParsedDoc {
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    return { frontmatter: undefined, body: text, bodyStart: 1, error: "file does not start with a --- frontmatter fence" };
  }
  const close = lines.indexOf("---", 1);
  if (close === -1) {
    return { frontmatter: undefined, body: text, bodyStart: 1, error: "frontmatter has no closing --- fence" };
  }
  const body = lines.slice(close + 1).join("\n");
  try {
    const value: unknown = parseYaml(lines.slice(1, close).join("\n"));
    if (!isRecord(value)) {
      return { frontmatter: undefined, body, bodyStart: close + 2, error: "frontmatter is not a mapping" };
    }
    return { frontmatter: value, body, bodyStart: close + 2 };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { frontmatter: undefined, body, bodyStart: close + 2, error: `frontmatter does not parse: ${message}` };
  }
}

/**
 * Body lines with fenced blocks blanked and inline code spans removed, so
 * prose checks never see code. Line positions are preserved.
 */
function proseLines(body: string): string[] {
  let fence: string | undefined;
  return body.split("\n").map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return "";
    }
    if (marker !== undefined) {
      fence = marker;
      return "";
    }
    return line.replaceAll(/(`+)[^`]*?\1/g, "");
  });
}

/** Inline code spans outside fenced blocks, with their 0-based body line. */
function inlineCodeSpans(body: string): Array<{ text: string; line: number }> {
  const spans: Array<{ text: string; line: number }> = [];
  let fence: string | undefined;
  for (const [index, line] of body.split("\n").entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    for (const match of line.matchAll(/(`+)([^`]+?)\1/g)) {
      const text = match[2];
      if (text !== undefined) spans.push({ text: text.trim(), line: index });
    }
  }
  return spans;
}

/** A backticked path worth resolving, stripped of a `:line` or `#anchor` suffix; else undefined. */
function candidatePath(span: string): string | undefined {
  if (!PATH_PREFIXES.some((prefix) => span.startsWith(prefix))) return undefined;
  if (/[\s$*<>[\]{|}]/.test(span)) return undefined;
  const path = span.replace(/#.*$/, "").replace(/:\d+(?:[:-]\d+)*$/, "");
  if (!/\/[^/]*[^./]\.[A-Za-z][\dA-Za-z]*$/.test(path)) return undefined;
  return path;
}

/** Git-ignored paths are runtime artifacts (logs, caches) that may not exist yet. */
function isGitIgnored(root: string, path: string): boolean {
  return spawnSync("git", ["-C", root, "check-ignore", "-q", "--", path], { stdio: "ignore" }).status === 0;
}

function pathResolves(root: string, path: string): boolean {
  if (existsSync(join(root, path)) || isGitIgnored(root, path)) return true;
  return (path.startsWith("src/") || path.startsWith("docs/")) && existsSync(join(root, "beebox", path));
}

function filesUnder(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

interface Target {
  file: string;
  expectedName: string;
  kind: "skill" | "agent";
  skillDir?: string;
}

function listTargets(root: string): Target[] {
  const targets: Target[] = [];
  const skillsDir = join(root, ".claude", "skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(skillsDir, entry.name);
      targets.push({ file: join(skillDir, "SKILL.md"), expectedName: entry.name, kind: "skill", skillDir });
    }
  }
  const agentsDir = join(root, ".claude", "agents");
  if (existsSync(agentsDir)) {
    for (const name of readdirSync(agentsDir).toSorted()) {
      if (!name.endsWith(".md")) continue;
      targets.push({ file: join(agentsDir, name), expectedName: basename(name, ".md"), kind: "agent" });
    }
  }
  return targets;
}

function skillNames(root: string): string[] {
  const skillsDir = join(root, ".claude", "skills");
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory());
}

type Add = (where: Omit<Finding, "file" | "message">, message: string) => void;

interface LintContext {
  root: string;
  skillNames: ReadonlySet<string>;
  target: Target;
  add: Add;
}

function lintFrontmatter(fm: Record<string, unknown>, context: LintContext): void {
  const { target, add } = context;
  if (fm.name !== target.expectedName) {
    add({ line: 1, severity: "error", rule: "name" }, `name ${JSON.stringify(fm.name ?? null)} does not match ${JSON.stringify(target.expectedName)}`);
  }
  const description = fm.description;
  if (typeof description !== "string" || description.trim() === "") {
    add({ line: 1, severity: "error", rule: "description" }, "description is missing or empty");
  } else if (description.length >= DESCRIPTION_LIMIT) {
    add({ line: 1, severity: "error", rule: "description" }, `description is ${description.length} characters; the limit is under ${DESCRIPTION_LIMIT}`);
  }
  if (target.kind !== "skill") return;
  for (const key of CODEX_IGNORED_KEYS) {
    if (key in fm) add({ line: 1, severity: "info", rule: "codex-ignored-key" }, `Codex ignores frontmatter key "${key}" in the .agents/skills mirror`);
  }
}

function lintBody(doc: ParsedDoc, context: LintContext): void {
  const { add } = context;
  const bodyLines = doc.body.replace(/\n$/, "").split("\n").length;
  if (bodyLines >= BODY_LINE_LIMIT) {
    add({ line: doc.bodyStart, severity: "error", rule: "body-length" }, `body is ${bodyLines} lines; the limit is under ${BODY_LINE_LIMIT}`);
  }
  for (const [index, line] of proseLines(doc.body).entries()) {
    for (const match of line.matchAll(SIGIL)) {
      const name = match[3] ?? "";
      if (!context.skillNames.has(name) || name === context.target.expectedName) continue;
      add(
        { line: doc.bodyStart + index, severity: "error", rule: "skill-sigil" },
        `bare ${match[2] ?? ""}${name} in prose invokes a skill; name the skill without the sigil or put it in a code span`,
      );
    }
  }
  for (const span of inlineCodeSpans(doc.body)) {
    const path = candidatePath(span.text);
    if (path !== undefined && !pathResolves(context.root, path)) {
      add({ line: doc.bodyStart + span.line, severity: "error", rule: "missing-path" }, `\`${path}\` does not exist`);
    }
  }
}

export function lintSkills(rootDir: string): Finding[] {
  const root = resolve(rootDir);
  const findings: Finding[] = [];
  const names = new Set(skillNames(root));

  for (const target of listTargets(root)) {
    const file = relative(root, target.file);
    const add: Add = (where, message) => {
      findings.push({ file, ...where, message });
    };
    if (!existsSync(target.file)) {
      add({ line: 1, severity: "error", rule: "missing-skill-file" }, "skill directory has no SKILL.md");
      continue;
    }
    const doc = parseDoc(readFileSync(target.file, "utf8"));
    if (doc.error !== undefined) add({ line: 1, severity: "error", rule: "frontmatter" }, doc.error);
    const context: LintContext = { root, skillNames: names, target, add };
    if (doc.frontmatter !== undefined) lintFrontmatter(doc.frontmatter, context);
    if (target.skillDir !== undefined) {
      for (const rel of filesUnder(target.skillDir, "")) {
        if (rel.split("/").length > 2) {
          add({ line: 1, severity: "error", rule: "reference-depth" }, `${rel} is nested more than one directory deep in the skill`);
        }
      }
    }
    lintBody(doc, context);
  }
  return findings;
}

function formatFinding(finding: Finding): string {
  return `${finding.file}:${finding.line}: ${finding.severity} ${finding.rule}: ${finding.message}`;
}

const USAGE = "usage: bin/skill-lint.ts [--json] [--quiet] [--root <dir>]";

class MissingRootValueError extends Error {
  constructor() {
    super(`--root needs a value\n${USAGE}`);
    this.name = "MissingRootValueError";
  }
}

class UnknownArgumentError extends Error {
  constructor(readonly arg: string) {
    super(`unknown argument: ${arg}\n${USAGE}`);
    this.name = "UnknownArgumentError";
  }
}

function main(): number {
  const args = process.argv.slice(2);
  let json = false;
  let quiet = false;
  let root = resolve(import.meta.dirname, "..");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--root") {
      const value = args[++i];
      if (value === undefined) throw new MissingRootValueError();
      root = resolve(value);
    } else throw new UnknownArgumentError(arg ?? "");
  }
  const findings = lintSkills(root).filter((finding) => !quiet || finding.severity === "error");
  if (json) console.log(JSON.stringify(findings, undefined, 2));
  else for (const finding of findings) console.log(formatFinding(finding));
  return findings.some((finding) => finding.severity === "error") ? 1 : 0;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("skill-lint.ts")) {
  process.exitCode = main();
}
