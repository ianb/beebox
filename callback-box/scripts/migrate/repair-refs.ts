#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Repair broken refs in a box by locating files of matching basename
 * elsewhere in the box.
 *
 * For each broken ref discovered via cardworks `extractRefs`:
 *   - Index every file in the box by basename.
 *   - Look up the missing ref's basename.
 *   - 0 candidates -> report "missing".
 *   - 1 candidate -> apply the fix.
 *   - N candidates -> prefer the one closest to the source card by path
 *     distance (siblings beat cousins). If two tie for closest, report
 *     "ambiguous" with the candidate list.
 *
 * Fix shape depends on ref form:
 *   - `attach/<name>`: move the file into the source card's
 *     `<stem>.attach/` scope (create the dir if needed).
 *   - everything else: rewrite the ref to an absolute `/from/box/root`
 *     path pointing at the actual file.
 *
 * Final report groups results into fixed / missing / ambiguous / errors.
 *
 * Idempotent. Default dry-run; pass `--apply` to mutate.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/repair-refs.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/repair-refs.ts <boxRoot> --apply
 */

import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { extractRefs, splitCardContent } from "cardworks";

interface RepairOutcome {
  card: string;
  refPath: string;
  ref: string;
  kind: "fix-rewrite" | "fix-move-attach" | "missing" | "ambiguous" | "error";
  detail: string;
}

const outcomes: RepairOutcome[] = [];

async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function walkAllFiles(dir: string, out: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walkAllFiles(full, out);
    else if (e.isFile()) out.push(full);
  }
}

function isCardFile(name: string): boolean { return name.endsWith(".card"); }

function cardStem(cardAbs: string): string {
  return basename(cardAbs).replace(/\.card$/, "").replace(/\.[^.]+$/, "");
}

interface RefCtx { boxRoot: string; sourceCardAbs: string }

function resolveRefPath(ctx: RefCtx, ref: string): string {
  const { boxRoot, sourceCardAbs } = ctx;
  if (ref.startsWith("/")) return join(boxRoot, ref.slice(1));
  if (ref === "attach" || ref.startsWith("attach/")) {
    const attachDir = join(dirname(sourceCardAbs), `${cardStem(sourceCardAbs)}.attach`);
    const rest = ref === "attach" ? "" : ref.slice("attach/".length);
    return rest === "" ? attachDir : join(attachDir, rest);
  }
  return join(dirname(sourceCardAbs), ref);
}

/**
 * Path distance between two absolute paths: number of segments that
 * differ after the common prefix (sum from both sides). Same dir = 0.
 */
function pathDistance(a: string, b: string): number {
  const as = a.split(sep);
  const bs = b.split(sep);
  let i = 0;
  while (i < as.length && i < bs.length && as[i] === bs[i]) i++;
  return (as.length - i) + (bs.length - i);
}

/**
 * How many trailing segments of `ref` (split on `/`) match the tail of
 * `candidatePath`, treating a `.attach` suffix on candidate segments as
 * equivalent to its stem. The basename itself is always one match.
 */
function refTailMatch(ref: string, candidatePath: string): number {
  const refSegs = ref.split("/").filter((s) => s !== "" && s !== ".");
  const candSegs = candidatePath.split(sep);
  let matches = 0;
  for (let i = 1; i <= refSegs.length && i <= candSegs.length; i++) {
    const r = refSegs[refSegs.length - i];
    const c = candSegs[candSegs.length - i].replace(/\.attach$/, "");
    if (r === c || r.replace(/\.attach$/, "") === c) matches = i;
    else break;
  }
  return matches;
}

function pickBestCandidate(
  candidates: string[],
  sourceCardAbs: string,
  ref: string,
): { winner: string | null; tied: string[] } {
  if (candidates.length === 1) return { winner: candidates[0], tied: [] };
  // Primary: longest tail match with the ref (captures dir hints in the
  // ref like `ledger/Sheet1.json`). Secondary: path distance to
  // the source card (siblings beat cousins).
  const scored = candidates
    .map((p) => ({
      path: p,
      tail: refTailMatch(ref, p),
      dist: pathDistance(p, sourceCardAbs),
    }))
    .sort((a, b) => (b.tail - a.tail) || (a.dist - b.dist));
  const best = scored[0];
  const tied = scored.filter((s) => s.tail === best.tail && s.dist === best.dist);
  if (tied.length === 1) return { winner: best.path, tied: [] };
  return { winner: null, tied: tied.map((c) => c.path) };
}

interface FrontmatterParts { fmText: string; body: string }

function readCardParts(content: string): FrontmatterParts | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  return { fmText: split.frontmatterText, body: split.body };
}

function writeCardParts(fields: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(fields)}---\n${body}`;
}

/**
 * Parse a ref path like `sources[2].ref` or `persons[0].ref` into a
 * sequence of object-key / array-index steps and update the leaf.
 * Returns true if the path resolved and the value was set.
 */
function setRefAtPath(
  fields: Record<string, unknown>,
  refPath: string,
  newValue: string,
): boolean {
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded by string length, paths are short
  const tokens = refPath.match(/([a-zA-Z_][a-zA-Z0-9_-]*)|\[(\d+)\]/g);
  if (tokens === null || tokens.length === 0) return false;
  let cursor: unknown = fields;
  for (let i = 0; i < tokens.length - 1; i++) {
    const tok = tokens[i];
    cursor = stepInto(cursor, tok);
    if (cursor === undefined) return false;
  }
  const last = tokens[tokens.length - 1];
  if (last.startsWith("[")) {
    const idx = Number(last.slice(1, -1));
    if (!Array.isArray(cursor)) return false;
    cursor[idx] = newValue;
    return true;
  }
  if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return false;
  (cursor as Record<string, unknown>)[last] = newValue;
  return true;
}

function stepInto(cursor: unknown, tok: string): unknown {
  if (tok.startsWith("[")) {
    const idx = Number(tok.slice(1, -1));
    if (!Array.isArray(cursor)) return undefined;
    return cursor[idx];
  }
  if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
  return (cursor as Record<string, unknown>)[tok];
}

interface RepairCtx {
  boxRoot: string;
  apply: boolean;
  basenameIndex: Map<string, string[]>;
}

async function repairCard(cardAbs: string, ctx: RepairCtx): Promise<void> {
  const { boxRoot, apply, basenameIndex } = ctx;
  let content: string;
  try { content = await readFile(cardAbs, "utf8"); } catch (e) {
    outcomes.push({ card: cardAbs, refPath: "", ref: "", kind: "error", detail: `read failed: ${(e as Error).message}` });
    return;
  }
  const parts = readCardParts(content);
  if (parts === null) return;
  let fields: Record<string, unknown>;
  try { fields = parseYaml(parts.fmText) as Record<string, unknown>; } catch (e) {
    outcomes.push({ card: cardAbs, refPath: "", ref: "", kind: "error", detail: `yaml parse: ${(e as Error).message}` });
    return;
  }
  if (fields === null || typeof fields !== "object") return;

  const refs = extractRefs(fields);
  if (refs.length === 0) return;

  let mutated = false;
  for (const { path: refPath, ref } of refs) {
    const target = resolveRefPath({ boxRoot, sourceCardAbs: cardAbs }, ref);
    if (await pathExists(target)) continue;

    const base = basename(ref);
    const candidates = basenameIndex.get(base);
    if (candidates === undefined || candidates.length === 0) {
      outcomes.push({ card: cardAbs, refPath, ref, kind: "missing", detail: `no file named ${base} in box` });
      continue;
    }

    const { winner, tied } = pickBestCandidate(candidates, cardAbs, ref);
    if (winner === null) {
      const list = tied.map((p) => relative(boxRoot, p)).join(", ");
      outcomes.push({ card: cardAbs, refPath, ref, kind: "ambiguous", detail: `tied: ${list}` });
      continue;
    }

    const isAttach = ref === "attach" || ref.startsWith("attach/");
    if (isAttach) {
      // Move the file into the card's attach scope. The ref already
      // names where it should land — derive the destination from the
      // ref, not from where the file currently sits.
      const destPath = resolveRefPath({ boxRoot, sourceCardAbs: cardAbs }, ref);
      if (winner === destPath) continue; // somehow already there
      const detail = `move ${relative(boxRoot, winner)} -> ${relative(boxRoot, destPath)}`;
      outcomes.push({ card: cardAbs, refPath, ref, kind: "fix-move-attach", detail });
      if (apply) {
        await mkdir(dirname(destPath), { recursive: true });
        await rename(winner, destPath);
        // Update the index so a later ref doesn't try to claim the same file.
        const list = basenameIndex.get(base);
        if (list !== undefined) {
          const next = list.filter((p) => p !== winner);
          next.push(destPath);
          basenameIndex.set(base, next);
        }
      }
    } else {
      const absRef = "/" + relative(boxRoot, winner).split(sep).join("/");
      const ok = setRefAtPath(fields, refPath, absRef);
      if (!ok) {
        outcomes.push({ card: cardAbs, refPath, ref, kind: "error", detail: `could not set ref at path ${refPath}` });
        continue;
      }
      outcomes.push({ card: cardAbs, refPath, ref, kind: "fix-rewrite", detail: `${ref} -> ${absRef}` });
      mutated = true;
    }
  }

  if (mutated && apply) {
    await writeFile(cardAbs, writeCardParts(fields, parts.body));
  }
}

function printReport(boxRoot: string, apply: boolean): void {
  const counts: Record<string, number> = {};
  for (const o of outcomes) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
  console.log("\nSummary:");
  for (const k of ["fix-rewrite", "fix-move-attach", "missing", "ambiguous", "error"]) {
    console.log(`  ${String(counts[k] ?? 0).padStart(5)}  ${k}`);
  }

  const fixes = outcomes.filter((o) => o.kind === "fix-rewrite" || o.kind === "fix-move-attach");
  if (fixes.length > 0) {
    console.log(`\nFixes (${String(fixes.length)})${apply ? "" : " — preview"}:`);
    for (const o of fixes.slice(0, 30)) {
      console.log(`  [${o.kind}] ${relative(boxRoot, o.card)} [${o.refPath}]`);
      console.log(`    ${o.detail}`);
    }
    if (fixes.length > 30) console.log(`  ... and ${String(fixes.length - 30)} more`);
  }

  const missing = outcomes.filter((o) => o.kind === "missing");
  if (missing.length > 0) {
    console.log(`\nMissing refs (${String(missing.length)}):`);
    for (const o of missing.slice(0, 40)) {
      console.log(`  ${relative(boxRoot, o.card)} [${o.refPath}] -> ${o.ref}`);
    }
    if (missing.length > 40) console.log(`  ... and ${String(missing.length - 40)} more`);
  }

  const ambig = outcomes.filter((o) => o.kind === "ambiguous");
  if (ambig.length > 0) {
    console.log(`\nAmbiguous refs (${String(ambig.length)}):`);
    for (const o of ambig.slice(0, 40)) {
      console.log(`  ${relative(boxRoot, o.card)} [${o.refPath}] -> ${o.ref}`);
      console.log(`    ${o.detail}`);
    }
    if (ambig.length > 40) console.log(`  ... and ${String(ambig.length - 40)} more`);
  }

  const errs = outcomes.filter((o) => o.kind === "error");
  if (errs.length > 0) {
    console.log(`\nErrors (${String(errs.length)}):`);
    for (const o of errs.slice(0, 20)) {
      console.log(`  ${relative(boxRoot, o.card)}: ${o.detail}`);
    }
  }

  if (!apply) console.log("\nDry run. Pass --apply to perform fixes.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const boxArg = positional[0];
  if (boxArg === undefined) {
    console.error("Usage: repair-refs <boxRoot> [--apply]");
    process.exit(1);
  }
  const boxRoot = resolve(boxArg);

  console.log(`Indexing files under ${boxRoot}...`);
  const allFiles: string[] = [];
  await walkAllFiles(boxRoot, allFiles);

  const basenameIndex = new Map<string, string[]>();
  for (const f of allFiles) {
    const b = basename(f);
    const list = basenameIndex.get(b);
    if (list === undefined) basenameIndex.set(b, [f]);
    else list.push(f);
  }
  const cards = allFiles.filter((p) => isCardFile(basename(p)));
  console.log(`Indexed ${String(allFiles.length)} files; scanning ${String(cards.length)} cards${apply ? " (APPLY)" : " (dry-run)"}`);

  for (const card of cards) {
    try {
      await repairCard(card, { boxRoot, apply, basenameIndex });
    } catch (e) {
      outcomes.push({ card, refPath: "", ref: "", kind: "error", detail: (e as Error).message });
    }
  }

  printReport(boxRoot, apply);
}

main().catch((e) => { console.error(e); process.exit(1); });
