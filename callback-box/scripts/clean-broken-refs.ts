#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * One-off data hygiene: remove broken references in a box.
 *
 * Actions, all safe and idempotent:
 *
 *   1. Image card whose filename.ref points to a missing file → delete
 *      the image card (the card is metadata about a JPG that no longer
 *      exists, so the card is orphaned).
 *
 *   2. Capture-session whose photo refs (markdown links to sibling
 *      *.image.card files) point to missing cards → remove the dead
 *      link lines. If no photos remain in the session, delete it too.
 *
 *   3. Record card with dead sources[].ref or persons[].ref → drop the
 *      dead entries. Record body and other fields are untouched. If the
 *      array becomes empty, remove the field.
 *
 *   4. Record persons[].ref using `../../../people/Foo.person.card`
 *      relative form that doesn't resolve → rewrite to absolute
 *      `/people/Foo.person.card` form if the absolute target exists.
 *
 *   5. Intake-job, calendar-review-job, question-followup-job with any
 *      dead items[]/changes[].ref → drop the dead entries. If no
 *      entries remain, delete the job (it has no real work left).
 *
 * Anything outside these categories is reported but not touched.
 *
 * Usage:
 *   pnpm exec tsx scripts/clean-broken-refs.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/clean-broken-refs.ts <boxRoot> --apply
 */

import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitCardContent } from "cardworks";

interface Action {
  kind: "delete-card" | "prune-refs" | "rewrite-ref";
  file: string;
  detail: string;
}

const actions: Action[] = [];
const unhandled: string[] = [];

async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

function isCardFile(name: string): boolean { return name.endsWith(".card"); }

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile() && isCardFile(e.name)) out.push(full);
  }
}

function typeFromFilename(absPath: string): string | undefined {
  const m = basename(absPath).match(/^.+\.([^.]+)\.card$/);
  return m ? m[1] : undefined;
}

/**
 * Resolve a ref the way cardworks does (subset): absolute = box-root;
 * `attach/...` = source card's <basename>.attach/ scope; everything
 * else = relative to source card's directory.
 */
interface RefCtx { boxRoot: string; sourceCardAbs: string }

function resolveRefPath(ctx: RefCtx, ref: string): string {
  const { boxRoot, sourceCardAbs } = ctx;
  if (ref.startsWith("/")) return join(boxRoot, ref.slice(1));
  if (ref === "attach" || ref.startsWith("attach/")) {
    const base = basename(sourceCardAbs).replace(/\.card$/, "");
    const stem = base.replace(/\.[^.]+$/, "");
    const attachDir = join(dirname(sourceCardAbs), `${stem}.attach`);
    const rest = ref === "attach" ? "" : ref.slice("attach/".length);
    return rest === "" ? attachDir : join(attachDir, rest);
  }
  return join(dirname(sourceCardAbs), ref);
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

interface HandleCtx { absPath: string; boxRoot: string; apply: boolean }

async function handleImageCard(ctx: HandleCtx): Promise<void> {
  const { absPath, boxRoot, apply } = ctx;
  const content = await readFile(absPath, "utf8");
  const parts = readCardParts(content);
  if (parts === null) return;
  let fields: Record<string, unknown>;
  try { fields = parseYaml(parts.fmText) as Record<string, unknown>; } catch { return; }
  if (fields === null) return;
  const filename = fields["filename"] as { ref?: string } | undefined;
  if (filename === undefined || typeof filename.ref !== "string") return;
  const targetPath = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, filename.ref);
  if (await pathExists(targetPath)) return;
  actions.push({ kind: "delete-card", file: absPath, detail: `missing ${filename.ref}` });
  if (apply) await unlink(absPath);
}

async function handleCaptureSession(ctx: HandleCtx): Promise<void> {
  const { absPath, boxRoot, apply } = ctx;
  // Capture-session is legacy XML; photo refs sit on their own lines as
  // bare paths inside the <photos> block. Match any line that contains
  // a `*.image.card` token (allowing spaces, accented chars, absolute
  // and relative forms). Resolve each via the standard ref resolver
  // and drop the line if the target's gone.
  const raw = await readFile(absPath, "utf8");
  // Two forms appear on photo-ref lines:
  //   <image-ref ref="./photo-001-Foo.image.card"/>   ← XML attr form
  //   ./photo-001.image.card                          ← bare path on its line
  // Try the quoted form first (preserves spaces in names), then bare.
  const lines = raw.split("\n");
  const kept: string[] = [];
  let dead = 0;
  let totalRefs = 0;
  for (const line of lines) {
    let ref: string | undefined;
    const quoted = line.match(/ref=["']([^"']*\.image\.card)["']/);
    if (quoted !== null) {
      ref = quoted[1];
    } else {
      // eslint-disable-next-line security/detect-unsafe-regex -- bounded by line length, capture-session lines are short
      const bare = line.match(/^\s*((?:\.{0,2}\/)?[^\s]\S*\.image\.card)\s*$/);
      if (bare !== null) ref = bare[1];
    }
    if (ref === undefined) { kept.push(line); continue; }
    totalRefs++;
    const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
    const exists = await pathExists(target);
    if (exists) kept.push(line);
    else dead++;
  }
  if (dead === 0) return;
  const newRaw = kept.join("\n");
  // If every photo ref is now gone, the session has no work product to
  // point at — delete it.
  if (dead === totalRefs) {
    actions.push({ kind: "delete-card", file: absPath, detail: `no photos remain (was ${String(totalRefs)})` });
    if (apply) await unlink(absPath);
    return;
  }
  actions.push({ kind: "prune-refs", file: absPath, detail: `dropped ${String(dead)} of ${String(totalRefs)} photo ref line(s)` });
  if (apply) await writeFile(absPath, newRaw);
}

async function handleRecord(ctx: HandleCtx): Promise<void> {
  const { absPath, boxRoot, apply } = ctx;
  const content = await readFile(absPath, "utf8");
  const parts = readCardParts(content);
  if (parts === null) return;
  let fields: Record<string, unknown>;
  try { fields = parseYaml(parts.fmText) as Record<string, unknown>; } catch { return; }
  if (fields === null) return;
  let mutated = false;
  const droppedSources: string[] = [];
  const droppedPersons: string[] = [];
  const rewrittenPersons: string[] = [];

  const sources = fields["sources"] as Array<{ ref?: string }> | undefined;
  if (Array.isArray(sources)) {
    const kept: typeof sources = [];
    for (const s of sources) {
      const ref = typeof s.ref === "string" ? s.ref : undefined;
      if (ref === undefined) { kept.push(s); continue; }
      const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
      if (await pathExists(target)) { kept.push(s); continue; }
      droppedSources.push(ref);
      mutated = true;
    }
    if (kept.length === 0) delete fields["sources"];
    else fields["sources"] = kept;
  }

  const persons = fields["persons"] as Array<{ ref?: string; name?: string }> | undefined;
  if (Array.isArray(persons)) {
    const kept: typeof persons = [];
    for (const p of persons) {
      const ref = typeof p.ref === "string" ? p.ref : undefined;
      if (ref === undefined) { kept.push(p); continue; }
      const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
      if (await pathExists(target)) { kept.push(p); continue; }
      // Try absolute-rewrite if ref ends in `.person.card`.
      const personFile = basename(ref);
      if (personFile.endsWith(".person.card")) {
        const absAlt = join(boxRoot, "people", personFile);
        if (await pathExists(absAlt)) {
          p.ref = `/people/${personFile}`;
          kept.push(p);
          rewrittenPersons.push(`${ref} → /people/${personFile}`);
          mutated = true;
          continue;
        }
      }
      droppedPersons.push(ref);
      mutated = true;
    }
    if (kept.length === 0) delete fields["persons"];
    else fields["persons"] = kept;
  }

  if (!mutated) return;
  const messages: string[] = [];
  if (droppedSources.length > 0) messages.push(`dropped ${String(droppedSources.length)} source(s)`);
  if (droppedPersons.length > 0) messages.push(`dropped ${String(droppedPersons.length)} person(s)`);
  if (rewrittenPersons.length > 0) messages.push(`rewrote ${String(rewrittenPersons.length)} person ref(s)`);
  actions.push({ kind: rewrittenPersons.length > 0 ? "rewrite-ref" : "prune-refs", file: absPath, detail: messages.join(", ") });
  if (apply) await writeFile(absPath, writeCardParts(fields, parts.body));
}

async function handleJob(ctx: HandleCtx & { listKey: "items" | "changes" }): Promise<void> {
  const { absPath, boxRoot, apply, listKey } = ctx;
  const content = await readFile(absPath, "utf8");
  const parts = readCardParts(content);
  if (parts === null) return;
  let fields: Record<string, unknown>;
  try { fields = parseYaml(parts.fmText) as Record<string, unknown>; } catch { return; }
  if (fields === null) return;
  const list = fields[listKey] as Array<{ ref?: string }> | undefined;
  if (!Array.isArray(list)) return;
  const kept: typeof list = [];
  let dropped = 0;
  for (const item of list) {
    const ref = typeof item.ref === "string" ? item.ref : undefined;
    if (ref === undefined) { kept.push(item); continue; }
    const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
    if (await pathExists(target)) { kept.push(item); continue; }
    dropped++;
  }
  if (dropped === 0) return;
  if (kept.length === 0) {
    actions.push({ kind: "delete-card", file: absPath, detail: `all ${String(dropped)} ${listKey} dead — deleting job` });
    if (apply) await unlink(absPath);
    return;
  }
  fields[listKey] = kept;
  actions.push({ kind: "prune-refs", file: absPath, detail: `dropped ${String(dropped)} dead ${listKey}` });
  if (apply) await writeFile(absPath, writeCardParts(fields, parts.body));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const boxRoot = positional[0];
  if (boxRoot === undefined) {
    console.error("Usage: clean-broken-refs <boxRoot> [--apply]");
    process.exit(1);
  }
  const abs = resolve(boxRoot);
  const cards: string[] = [];
  await walk(abs, cards);
  console.log(`Scanning ${String(cards.length)} cards under ${abs}${apply ? " (APPLY)" : " (dry-run)"}`);

  for (const card of cards) {
    const type = typeFromFilename(card);
    if (type === undefined) continue;
    try {
      switch (type) {
        case "image":
          await handleImageCard({ absPath: card, boxRoot: abs, apply });
          break;
        case "capture-session":
          await handleCaptureSession({ absPath: card, boxRoot: abs, apply });
          break;
        case "record":
          await handleRecord({ absPath: card, boxRoot: abs, apply });
          break;
        case "intake-job":
        case "question-followup-job":
          await handleJob({ absPath: card, boxRoot: abs, apply, listKey: "items" });
          break;
        case "calendar-review-job":
          await handleJob({ absPath: card, boxRoot: abs, apply, listKey: "changes" });
          break;
        default:
          break;
      }
    } catch (e) {
      unhandled.push(`${relative(abs, card)}: ${(e as Error).message}`);
    }
  }

  const grouped: Record<string, number> = {};
  for (const a of actions) {
    const key = `${a.kind} (${typeFromFilename(a.file) ?? "?"})`;
    grouped[key] = (grouped[key] ?? 0) + 1;
  }
  console.log("\nSummary:");
  for (const [k, v] of Object.entries(grouped).sort()) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  if (unhandled.length > 0) {
    console.log(`\n${String(unhandled.length)} error(s):`);
    for (const u of unhandled.slice(0, 20)) console.log(`  ${u}`);
  }
  if (!apply) console.log("\nDry run. Pass --apply to perform.");
}

main().catch((e) => { console.error(e); process.exit(1); });
