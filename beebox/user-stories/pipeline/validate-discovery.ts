/**
 * Fail-closed validator for the discovery phase.
 *
 * Discovery spreads ~90 agents over ~21 units, each writing its own JSON file. Any of them can
 * fail, write malformed JSON, duplicate an id, or return an index that disagrees with the file
 * it wrote — and none of that is visible in the rendered catalog. This walks every expected
 * artifact and refuses to let the pipeline proceed on a partial one.
 *
 * Usage: pnpm exec tsx beebox/user-stories/pipeline/validate-discovery.ts
 * Exit 0 = complete and clean. Exit 1 = do not proceed to verification.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { errorMessage } from "../../src/lib/error-guards.ts";
import { isRecord } from "../../src/lib/is-record.ts";


const ROOT = resolve(import.meta.dirname, "../../..");
const BASE = resolve(import.meta.dirname, "../work");
const AREAS_DIR = join(BASE, "areas");

const GROUPS = new Set([
  "chat", "capture", "cards", "browse", "connectors", "messaging",
  "automation", "search", "knowledge", "publish", "admin", "deploy",
  "mobile", "dev", "other",
]);
const AUDIENCES = new Set(["web-ui", "agent-scripts", "operator"]);

/** Every unit that must have produced at least a round-1 file. Mirrors discover.workflow.js. */
const EXPECTED_UNITS = [
  "fe-chat", "fe-view", "fe-pages", "fe-lib",
  "core-chat", "core-commands", "core-box", "core-capture", "core-auto",
  "cards-schemas", "connectors", "services", "webapp", "cli",
  "seam-capture", "seam-chat", "seam-cards", "seam-automation",
  "seam-connectors", "seam-access", "seam-publish",
];

interface Story {
  id: string
  title: string
  story: string
  group: string
  audience: string
  files: string[]
  evidence: string
  sourceFile: string
}

const fatal: string[] = [];
const warn: string[] = [];

if (!existsSync(AREAS_DIR)) {
  console.error(`FATAL: ${AREAS_DIR} does not exist — discovery never ran.`);
  process.exit(1);
}

const files = readdirSync(AREAS_DIR).filter((f) => f.endsWith(".json")).toSorted();

// 1. Every expected unit produced a round-1 file.
for (const unit of EXPECTED_UNITS) {
  if (!files.includes(`${unit}.r1.json`)) {
    fatal.push(`unit "${unit}" has no ${unit}.r1.json — that territory was never swept`);
  }
}

// 2. Every file parses, and every story in it is well formed.
const stories: Story[] = [];
const seenIds = new Map<string, string>();

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}

const REQUIRED_FIELDS = ["id", "title", "story", "group", "audience", "evidence"];

for (const file of files) {
  const path = join(AREAS_DIR, file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fatal.push(`${file}: not valid JSON (${errorMessage(err)})`);
    continue;
  }

  const rawStories = isRecord(parsed) ? parsed["stories"] : undefined;
  if (!Array.isArray(rawStories)) {
    fatal.push(`${file}: missing a top-level "stories" array`);
    continue;
  }

  for (const [i, raw] of rawStories.entries()) {
    const where = `${file}[${i}]`;
    if (!isRecord(raw)) {
      fatal.push(`${where}: not an object`);
      continue;
    }
    const record = raw;

    const missing = REQUIRED_FIELDS.filter((k) => stringField(record, k) === undefined);
    if (missing.length > 0) {
      fatal.push(`${where}: missing/empty ${missing.join(", ")}`);
      continue;
    }

    const id = stringField(record, "id") ?? "";
    const group = stringField(record, "group") ?? "";
    const audience = stringField(record, "audience") ?? "";
    const story = stringField(record, "story") ?? "";

    const prior = seenIds.get(id);
    if (prior !== undefined) {
      fatal.push(`duplicate id "${id}" in ${where} (already in ${prior}) — ids are the pipeline join key`);
      continue;
    }
    seenIds.set(id, where);

    if (!GROUPS.has(group)) fatal.push(`${where} (${id}): group "${group}" not in the vocabulary`);
    if (!AUDIENCES.has(audience)) fatal.push(`${where} (${id}): audience "${audience}" not in the vocabulary`);
    if (!story.toLowerCase().includes("i want")) {
      warn.push(`${where} (${id}): story text is not in "As a … I want … so that …" form`);
    }

    const rawFiles = record.files;
    const cited = Array.isArray(rawFiles) ? rawFiles.filter((f): f is string => typeof f === "string") : [];
    if (cited.length === 0) {
      warn.push(`${where} (${id}): cites no files`);
    }
    for (const f of cited) {
      if (!existsSync(join(ROOT, f))) {
        warn.push(`${where} (${id}): cited path does not exist — ${f}`);
      }
    }

    stories.push({
      id,
      title: stringField(record, "title") ?? "",
      story,
      group,
      audience,
      files: cited,
      evidence: stringField(record, "evidence") ?? "",
      sourceFile: file,
    });
  }
}

// 3. Report.
const byUnit = new Map<string, number>();
for (const s of stories) {
  const unit = s.sourceFile.replace(/\.r\d+\.json$/, "").replace(/\.json$/, "");
  byUnit.set(unit, (byUnit.get(unit) ?? 0) + 1);
}

console.log(`Files:   ${files.length}`);
console.log(`Stories: ${stories.length}`);
console.log("");
for (const unit of [...byUnit.keys()].toSorted()) {
  console.log(`  ${unit.padEnd(24)} ${String(byUnit.get(unit)).padStart(4)}`);
}
console.log("");

const emptyCited = stories.filter((s) => s.files.length === 0).length;
if (emptyCited > 0) console.log(`${emptyCited} stories cite no files`);

if (warn.length > 0) {
  console.log(`\n${warn.length} warnings:`);
  for (const w of warn.slice(0, 40)) console.log(`  ! ${w}`);
  if (warn.length > 40) console.log(`  … ${warn.length - 40} more`);
}

if (fatal.length > 0) {
  console.log(`\n${fatal.length} FATAL:`);
  for (const f of fatal) console.log(`  ✗ ${f}`);
  console.log("\nDo NOT proceed to verification. Re-run the failed units first.");
  process.exit(1);
}

writeFileSync(
  join(BASE, "stories.json"),
  `${JSON.stringify({ stories }, null, 2)}\n`,
);
console.log(`\nOK — wrote user-stories/work/stories.json (${stories.length} stories)`);
