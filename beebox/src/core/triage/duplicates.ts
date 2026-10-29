/**
 * Exact-duplicate inbox items: every original file's SHA-256 matches a filed
 * tracked file or an earlier kept item in the same check. No model call.
 * Removable ones carry no authored context; everything else is for review.
 */
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { parseFrontmatterObject } from "../../exports/cards.js";
import { parseRef, resolveRefPath } from "../../shared/ref-path/core.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { invariant } from "../../shared/invariant.js";
import { errnoCode } from "../../shared/error-guards.js";
import { getBoxDir, isCardFile } from "../../lib/paths/core.js";
import { parseAnnexPointer } from "../../lib/annex-pointer.js";
import { sha256Hex } from "../../lib/content-hash.js";
import { isWithin } from "../../lib/box-containment.js";
import { hasCommits } from "../../lib/git/core/operations.js";
import { withBoxGitLock } from "../../lib/git-lock.js";
import type { CommandContext } from "../command-types.js";
import { moveCardsToTrash, commitTrashReceipt } from "../commands/trash/command.js";
import { moveFileToTrash } from "../commands/trash/file.js";
import { listScope } from "./evidence/core.js";
import { fieldRef } from "./evidence/packing.js";

export interface DuplicateFinding {
  sourceRef: string;
  disposition: "removable" | "review";
  originals: Array<{ ref: string; sha256: string; copyOf: string }>;
}

/** Originals smaller than this never count: tiny files collide by accident. */
const MIN_ORIGINAL_BYTES = 1024;
/** Same cap as `annex-pointer.ts`: only a file this small can be an unlocked pointer. */
const POINTER_MAX_BYTES = 1024;
const INDEX_BATCH = 32;

interface Digest { size: number | null; sha256: string }
interface DigestContext { boxRoot: string; wanted: (size: number) => boolean }

const toRef = (rel: string): string => `/${rel.split(path.sep).join("/")}`;

/** Box-relative path of a file ref, failing closed on escapes. */
export function itemPath(sourceRef: string): string {
  const parsed = parseRef(sourceRef);
  invariant(parsed.fragment === undefined && parsed.query === undefined, `Duplicate check needs a file ref: ${sourceRef}`);
  const relative = resolveRefPath({ fromPath: undefined, ref: parsed.path, kind: "write-target" });
  invariant(relative !== null, `Invalid box ref: ${sourceRef}`);
  return relative;
}

async function hashFile(abs: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(abs), hash);
  return hash.digest("hex");
}

/** Local bytes behind a non-SHA-256 annex link; null when absent or outside the box. */
async function linkedDigest(context: DigestContext, abs: string): Promise<Digest | null> {
  let real: string;
  try { real = await fs.realpath(abs); }
  catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
  if (!isWithin(await fs.realpath(context.boxRoot), real)) return null;
  const { size } = await fs.stat(real);
  return context.wanted(size) ? { size, sha256: await hashFile(real) } : null;
}

/** SHA-256 from an annex key when it has one, else from local bytes; null when unknowable or not `wanted`. */
async function digestOf(context: DigestContext, abs: string): Promise<Digest | null> {
  let stat;
  try { stat = await fs.lstat(abs); }
  catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
  if (stat.isSymbolicLink()) {
    const pointer = parseAnnexPointer(Buffer.from(`/annex/objects/${path.basename(await fs.readlink(abs))}`));
    // Not an annex link: never follow it.
    if (pointer === null) return null;
    return pointer.sha256 === null ? linkedDigest(context, abs) : { size: pointer.size, sha256: pointer.sha256 };
  }
  if (!stat.isFile()) return null;
  if (stat.size <= POINTER_MAX_BYTES) {
    const bytes = await fs.readFile(abs);
    const pointer = parseAnnexPointer(bytes);
    // An unlocked pointer of another backend means the bytes are absent.
    if (pointer !== null) return pointer.sha256 === null ? null : { size: pointer.size, sha256: pointer.sha256 };
    return context.wanted(bytes.length) ? { size: bytes.length, sha256: sha256Hex(bytes) } : null;
  }
  return context.wanted(stat.size) ? { size: stat.size, sha256: await hashFile(abs) } : null;
}

/** First tracked path (sorted) per SHA-256, outside the inbox and trash. */
async function filedIndex(boxRoot: string, sizes: Set<number>): Promise<Map<string, string>> {
  const excluded = [getBoxDir(boxRoot, "inbox"), getBoxDir(boxRoot, "trash")].map((dir) => `${path.relative(boxRoot, dir)}/`);
  const files = (await simpleGit(boxRoot).raw(["ls-files", "-z"])).split("\0")
    .filter((file) => file !== "" && !excluded.some((prefix) => file.startsWith(prefix))).toSorted();
  const index = new Map<string, string>();
  const context: DigestContext = { boxRoot, wanted: (size) => sizes.has(size) };
  for (let start = 0; start < files.length; start += INDEX_BATCH) {
    const batch = files.slice(start, start + INDEX_BATCH);
    const digests = await Promise.all(batch.map((file) => digestOf(context, path.join(boxRoot, file))));
    for (const [i, digest] of digests.entries()) {
      const file = batch[i];
      if (digest !== null && file !== undefined && !index.has(digest.sha256)) index.set(digest.sha256, toRef(file));
    }
  }
  return index;
}

/** The PDF a `.pdf.card`'s `filename` names, box-relative; null when it names none. */
async function pdfSource(boxRoot: string, card: string): Promise<string | null> {
  const fields = parseFrontmatterObject(await fs.readFile(path.join(boxRoot, card), "utf8"));
  const filename = fields ? fieldRef(fields.filename) : undefined;
  if (filename === undefined || !/^attach\/[^/]+\.pdf$/u.test(filename)) return null;
  return resolveRefPath({ fromPath: toRef(card), ref: parseRef(filename).path, kind: "card" });
}

/** A bare file is its own original; a card's are its non-card scope files outside any `.pdf.card`'s derivatives. */
async function originalFiles(boxRoot: string, item: string): Promise<string[]> {
  if (!isCardFile(item)) return [item];
  const scope = (await listScope(path.join(boxRoot, attachDirFor(item)))).map((file) => path.relative(boxRoot, file));
  const derivativeDirs: string[] = [];
  const sources = new Set<string>();
  for (const card of [item, ...scope].filter((file) => file.endsWith(".pdf.card"))) {
    derivativeDirs.push(`${attachDirFor(card)}/`);
    const source = await pdfSource(boxRoot, card);
    if (source !== null) sources.add(source);
  }
  return scope.filter((file) => !isCardFile(file) && (sources.has(file) || !derivativeDirs.some((dir) => file.startsWith(dir))));
}

/** Counted originals with digests; null when one cannot be hashed, so the item cannot be proven a duplicate. */
async function itemDigests(boxRoot: string, item: string): Promise<Array<{ ref: string; digest: Digest }> | null> {
  const result: Array<{ ref: string; digest: Digest }> = [];
  for (const file of await originalFiles(boxRoot, item)) {
    const digest = await digestOf({ boxRoot, wanted: () => true }, path.join(boxRoot, file));
    if (digest === null) return null;
    if (digest.size === null || digest.size >= MIN_ORIGINAL_BYTES) result.push({ ref: toRef(file), digest });
  }
  return result;
}

/**
 * The whole scope is exactly what one import wrote. Committed: every scope file
 * arrived in one commit and nothing has changed or been added since, so a card
 * authored later in the scope (a note) keeps the item for review. Never
 * committed (an import left staged): every entry is new.
 */
async function scopeUnedited(boxRoot: string, card: string): Promise<boolean> {
  const git = simpleGit(boxRoot);
  const scope = [card, attachDirFor(card)];
  const commits = await hasCommits(boxRoot)
    ? new Set((await git.raw(["log", "--format=%H", "--", ...scope])).split("\n").filter(Boolean))
    : new Set<string>();
  const status = (await git.raw(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...scope])).split("\0").filter(Boolean);
  if (commits.size === 1) return status.length === 0;
  return commits.size === 0 && status.every((entry) => entry.startsWith("?? ") || entry.startsWith("A  "));
}

/**
 * Every card in the scope is one the session's own manifest lists, or lies in a
 * listed card's attach scope. A card added later (a note) is not listed, and
 * this holds even after intake moves the scope and its history is lost.
 */
async function scopeIsManifest(boxRoot: string, options: { item: string; fields: Record<string, unknown> }): Promise<boolean> {
  const attach = attachDirFor(options.item);
  const listed = ["images", "files", "audio-clips"].flatMap((key) => {
    const value = options.fields[key];
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  }).map((entry) => path.join(attach, entry.replace(/^attach\//u, "")));
  const cards = (await listScope(path.join(boxRoot, attach))).map((file) => path.relative(boxRoot, file)).filter(isCardFile);
  return cards.every((card) => listed.includes(card) || listed.some((owner) => card.startsWith(`${attachDirFor(owner)}/`)));
}

/** Removable: a bare file, or an unannotated, voice-free scan-upload session no one has edited. */
async function dispositionOf(boxRoot: string, item: string): Promise<DuplicateFinding["disposition"]> {
  if (!isCardFile(item)) return "removable";
  if (!item.endsWith(".capture-session.card")) return "review";
  const fields = parseFrontmatterObject(await fs.readFile(path.join(boxRoot, item), "utf8"));
  if (!fields) return "review";
  const uploader = fields.uploader ?? fields.source;
  const clips = fields["audio-clips"];
  const voiceFree = clips === undefined || clips === null || (Array.isArray(clips) && clips.length === 0);
  if (typeof uploader !== "string" || !uploader.startsWith("scan-upload/") || fields.annotated === true || !voiceFree) return "review";
  return await scopeIsManifest(boxRoot, { item, fields }) && await scopeUnedited(boxRoot, item) ? "removable" : "review";
}

/** Check items in sorted ref order; the first of several identical items is kept and the later ones are its duplicates. */
export async function findExactDuplicates(boxRoot: string, sourceRefs: string[]): Promise<DuplicateFinding[]> {
  const items = [...new Set(sourceRefs.map(itemPath))].toSorted();
  // Only inbox items are candidates; a filed document must never match itself.
  const inbox = `${path.relative(boxRoot, getBoxDir(boxRoot, "inbox"))}/`;
  for (const item of items) invariant(item.startsWith(inbox), `Duplicate check takes inbox items only: ${toRef(item)}`);
  const digests = new Map<string, Array<{ ref: string; digest: Digest }>>();
  for (const item of items) {
    const found = await itemDigests(boxRoot, item);
    if (found !== null && found.length > 0) digests.set(item, found);
  }
  if (digests.size === 0) return [];
  const sizes = new Set([...digests.values()].flat().flatMap(({ digest }) => digest.size === null ? [] : [digest.size]));
  const filed = await filedIndex(boxRoot, sizes);
  const kept = new Map<string, string>();
  const findings: DuplicateFinding[] = [];
  for (const [item, originals] of digests) {
    const matched = originals.map(({ ref, digest }) => ({ ref, sha256: digest.sha256, copyOf: filed.get(digest.sha256) ?? kept.get(digest.sha256) }));
    const complete = matched.flatMap(({ ref, sha256, copyOf }) => copyOf === undefined ? [] : [{ ref, sha256, copyOf }]);
    if (complete.length === matched.length) {
      findings.push({ sourceRef: toRef(item), disposition: await dispositionOf(boxRoot, item), originals: complete });
      continue;
    }
    for (const { ref, sha256 } of matched) if (!kept.has(sha256)) kept.set(sha256, ref);
  }
  return findings;
}

export interface DuplicateRemoval { sourceRef: string; copyOf: string; trashRefs: string[]; commit: string | null }

class StaleDuplicateFindingError extends Error {
  readonly ref: string;
  constructor(ref: string, problem: "changed" | "is no longer a duplicate") {
    super(`Stale duplicate finding: ${ref} ${problem}; check again`);
    this.name = "StaleDuplicateFindingError";
    this.ref = ref;
  }
}

const findingKey = (finding: DuplicateFinding): string => JSON.stringify([finding.disposition, finding.originals]);

/**
 * Under the box Git lock, check each removable finding again from scratch (its
 * originals, their filed copies' current bytes, its disposition) and trash it
 * with its own scoped commit only if the fresh finding is identical.
 */
export async function applyDuplicateRemovals(boxRoot: string, options: {
  findings: DuplicateFinding[];
  /** Every ref the findings were checked against, so a copy of an earlier kept item still matches. */
  checked: string[];
  ctx?: CommandContext;
}): Promise<DuplicateRemoval[]> {
  const ctx = options.ctx ?? { boxRoot, write: () => {}, writeLine: () => {} };
  const removable = options.findings.filter((finding) => finding.disposition === "removable");
  return withBoxGitLock(boxRoot, async () => {
    const fresh = new Map((await findExactDuplicates(boxRoot, options.checked)).map((finding) => [finding.sourceRef, finding]));
    for (const finding of removable) {
      const now = fresh.get(finding.sourceRef);
      if (now === undefined || findingKey(now) !== findingKey(finding)) throw new StaleDuplicateFindingError(finding.sourceRef, now === undefined ? "is no longer a duplicate" : "changed");
    }
    const removals: DuplicateRemoval[] = [];
    for (const finding of removable) {
      const copyOf = [...new Set(finding.originals.map((original) => original.copyOf))].join(", ");
      const item = itemPath(finding.sourceRef);
      const receipt = isCardFile(item) ? await moveCardsToTrash(ctx, [item]) : await moveFileToTrash(boxRoot, item);
      const commit = await commitTrashReceipt(boxRoot, {
        receipt, reason: `exact duplicate of ${copyOf}`, trailers: { "Trashed-By": "bbx triage duplicates", "Triage-Duplicate-Of": copyOf },
      });
      removals.push({ sourceRef: finding.sourceRef, copyOf, trashRefs: receipt.moves.map((move) => toRef(move.destPath)), commit });
    }
    return removals;
  });
}
