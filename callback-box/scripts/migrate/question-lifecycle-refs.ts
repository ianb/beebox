/**
 * Second pass for the question-lifecycle migration: relocating a stray
 * question card (see `question-lifecycle.ts`) can leave OTHER cards holding
 * a now-broken `ref`/`refs` pointing at its old path — e.g. an intake-job
 * card whose `items[]` list the individual pieces of a scan-import batch,
 * including the question cards that batch created. This walks every `.card`
 * file in the box and rewrites any ref matching a relocated question card's
 * old path to its new `box/questions/...` path.
 *
 * Ref convention (see `extractRefs` in `src/cards/schema.ts`): a key
 * literally named `ref` holds a single path string; a key literally named
 * `refs` holds an array of path strings. Refs may be written with or
 * without a leading `/` — both forms are rewritten, preserving the leading
 * slash if the original had one.
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function splitCard(raw: string): { fm: string; body: string } | null {
  const m = raw.match(/^---\r?\n([\S\s]*?)\r?\n---\r?\n?([\S\s]*)$/);
  if (m === null) return null;
  return { fm: m[1] ?? "", body: m[2] ?? "" };
}

function renamedRef(ref: string, renameMap: ReadonlyMap<string, string>): string | null {
  const hadSlash = ref.startsWith("/");
  const normalized = hadSlash ? ref.slice(1) : ref;
  const renamed = renameMap.get(normalized);
  if (renamed === undefined) return null;
  return hadSlash ? `/${renamed}` : renamed;
}

/** Rewrite `ref`/`refs` values anywhere in the tree that match `renameMap`. Mutates in place. */
export function rewriteRefs(node: unknown, renameMap: ReadonlyMap<string, string>): boolean {
  let changed = false;
  if (Array.isArray(node)) {
    for (const item of node) if (rewriteRefs(item, renameMap)) changed = true;
    return changed;
  }
  if (!isRecord(node)) return false;

  if (typeof node["ref"] === "string") {
    const renamed = renamedRef(node["ref"], renameMap);
    if (renamed !== null) {
      node["ref"] = renamed;
      changed = true;
    }
  }
  if (Array.isArray(node["refs"])) {
    node["refs"] = node["refs"].map((r) => {
      if (typeof r !== "string") return r;
      const renamed = renamedRef(r, renameMap);
      if (renamed === null) return r;
      changed = true;
      return renamed;
    });
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "ref" || key === "refs") continue;
    if (rewriteRefs(value, renameMap)) changed = true;
  }
  return changed;
}

/** Rewrite one card's text, or null if nothing changed / unparseable. */
export function rewriteCardRefsText(raw: string, renameMap: ReadonlyMap<string, string>): string | null {
  const split = splitCard(raw);
  if (split === null) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(split.fm);
  } catch (_e) {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!rewriteRefs(parsed, renameMap)) return null;
  return `---\n${stringifyYaml(parsed)}---\n${split.body}`;
}

const SKIP_DIRS = new Set([".git", "node_modules"]);

async function findCards(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".card")) out.push(full);
    }
  }
  await walk(root);
  return out;
}

/** Walk every card in the box, rewriting refs that point at a relocated question card. */
export async function repairExternalRefs(
  boxRoot: string,
  { renameMap, apply }: { renameMap: ReadonlyMap<string, string>; apply: boolean }
): Promise<{ fixedFiles: string[] }> {
  if (renameMap.size === 0) return { fixedFiles: [] };
  const fixedFiles: string[] = [];
  for (const absPath of await findCards(boxRoot)) {
    const raw = await readFile(absPath, "utf8");
    const rewritten = rewriteCardRefsText(raw, renameMap);
    if (rewritten === null) continue;
    fixedFiles.push(relative(boxRoot, absPath));
    if (apply) await writeFile(absPath, rewritten);
  }
  return { fixedFiles };
}
