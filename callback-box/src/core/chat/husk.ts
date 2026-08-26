/**
 * Chat husks — a `chat` card per web chat session (docs/plans/chat-husks.md).
 *
 * The husk is the session's noun: identity (`session` id, `context-dir`)
 * plus editorial fields, created eagerly at session-id assignment and
 * backfilled once for pre-husk history. Activity/freshness deliberately
 * stays in runtime bookkeeping — the card never changes just because the
 * conversation continued.
 *
 * This is the writing half: creating a husk, stamping its provenance, and the
 * boot-time reconcile. Reading one lives in `husk-read.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { renderFrontmatterBlock, splitCardContent } from "../../cards/index.js";
import { createChatHuskTemplate } from "../../schemas/chat.js";
import { loadHistoryEntries, resolveSessionLogPath, type SessionHistoryEntry } from "./session/history.js";
import { localOrigin, type LocalOrigin } from "./session/origin.js";
import { withCardLock } from "../../lib/card-lock.js";
import { loadAgentEngine, type AgentEngine } from "../box/config.js";
import { extractSnippet } from "../../cli/lib/session-text.js";
import { errnoCode } from "../../lib/error-guards.js";
import { readCodexSessionUpdatedAt } from "./session/codex-transcript.js";
import { loadSessionHistory } from "./session/load-history.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import {
  CHAT_HUSK_DIR,
  findChatHuskEntry,
  groupHusksBySession,
  listChatHusks,
  parseHuskFrontmatter,
  shortId,
  type ChatHuskEntry,
} from "./husk-read.js";

/** Keep husk titles bookmark-sized, not transcript-sized. */
const TITLE_MAX_LEN = 80;

/** `2026-07-02_59fc20dd.chat.card` — date names the file, the suffix is a lookup hint. */
function huskFileName(sessionId: string, date: Date): string {
  return `${date.toISOString().slice(0, 10)}_${shortId(sessionId)}.chat.card`;
}

/** Best-effort title from the transcript's first user message; null when unavailable. */
async function readSnippetTitle(boxRoot: string, sessionId: string): Promise<string | null> {
  try {
    const { entries } = await loadSessionHistory(boxRoot, {
      sessionId,
      slice: { mode: "page", offset: 0, limit: 100 },
    });
    const raw = entries.find((entry) => entry.type === "user")?.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (raw === undefined) return null;
    // `extractSnippet`, not a hand-rolled clean: it is the single cleaning step
    // between a raw user message and a display label
    // (`cli/lib/session-text.ts`), and it strips the `<typed>`/`<speech>` shell
    // as well as the `<chat-app …/>` snapshot prepend. This used to strip only
    // the latter, so a husk titled from an existing transcript was named
    // `<typed user="…" user-email="…">…</typed>` — putting a sender's email
    // address into a committed card title and into the session chip
    // (`issues/bugs/2026-08-25-backfilled-husk-title-keeps-the-typed-wrapper.md`).
    return extractSnippet(raw, TITLE_MAX_LEN);
  } catch (_e) {
    // No transcript yet (brand-new session) or unreadable — the husk starts
    // untitled; enrichment is editorial, not plumbing.
    return null;
  }
}

/**
 * Ensure a husk card exists for a session; returns its box-relative path.
 *
 * Idempotent on the `session` field, not on the filename: a husk renamed to
 * something without the `_<shortid>` suffix is still found, so resuming a
 * renamed chat doesn't mint a second card pointing at the same session
 * (`docs/plans/chat-session-identity.md`, Track 1). `date` names the file
 * (defaults to now; backfill passes the transcript mtime so old husks sort by
 * when the chat happened).
 */
export async function ensureChatHusk(boxRoot: string, opts: { sessionId: string; contextDir?: string; engine?: AgentEngine; date?: Date }): Promise<string> {
  const existing = await findChatHuskEntry(boxRoot, opts.sessionId);
  if (existing !== null) return existing.path;

  const title = await readSnippetTitle(boxRoot, opts.sessionId);
  // Provenance is written at CREATE only. The transcript this husk points at
  // is being written on this machine right now, so this is the one moment the
  // origin is known without inference — and a value already on a card is never
  // second-guessed (a resume from another checkout must not restamp it).
  const origin = await localOrigin();
  // Same fallback as `appendHistory` (`session/history.ts`), not a second
  // default: an engine the caller didn't name is whatever the box runs now.
  const engine = opts.engine ?? await loadAgentEngine(boxRoot);
  const relPath = `${CHAT_HUSK_DIR}/${huskFileName(opts.sessionId, opts.date ?? new Date())}`;
  const absPath = path.join(boxRoot, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const content = createChatHuskTemplate({
    session: opts.sessionId,
    ...(opts.contextDir !== undefined ? { contextDir: opts.contextDir } : {}),
    engine,
    origin: origin.id,
    originName: origin.name,
    ...(title !== null ? { title } : {}),
  });
  // `wx` so a concurrent ensure can't clobber; losing the race is success.
  try {
    await fs.writeFile(absPath, content, { flag: "wx" });
  } catch (e) {
    if (errnoCode(e) !== "EEXIST") throw e;
  }
  return relPath;
}

/**
 * When this machine's copy of a session's transcript was last written, or null
 * when it holds none. The one "is the transcript here?" check: reconcile skips
 * ghost history entries with it, and the provenance backfill uses the same
 * answer to decide whether this machine is the session's origin.
 */
async function transcriptMtime(boxRoot: string, opts: { sessionId: string; engine: AgentEngine }): Promise<Date | null> {
  try {
    return opts.engine === "codex"
      ? await readCodexSessionUpdatedAt(boxRoot, opts.sessionId)
      : (await fs.stat(await resolveSessionLogPath(boxRoot, opts.sessionId))).mtime;
  } catch (_e) {
    // Absent (or unreadable) transcript — the caller's whole question.
    return null;
  }
}

/**
 * Add the machine-owned provenance fields to an existing husk, frontmatter
 * only — the body and every other field are carried through untouched.
 * Returns whether anything was written.
 *
 * The card is re-read under `withCardLock` and re-checked for `origin`,
 * because the snapshot the caller matched on was taken outside the lock and
 * chat review writes to the same cards. The write is atomic because the target
 * is a git-tracked card: `fs.writeFile` truncates first, so a crash mid-write
 * would leave a truncated card in the working tree.
 *
 * Across processes this stays last-writer-wins with the nightly review, and
 * that is accepted: the stamp is three fields, it is re-read immediately
 * before the write, and the review re-reads the card under its own lock — so
 * the most a lost write costs is one boot's provenance, which the next boot
 * writes again.
 */
async function stampHuskProvenance(absPath: string, args: { engine: AgentEngine; origin: LocalOrigin }): Promise<boolean> {
  return withCardLock(absPath, async () => {
    const content = await fs.readFile(absPath, "utf-8");
    const split = splitCardContent(content);
    const fields = parseHuskFrontmatter(content);
    // Unreadable frontmatter: `listChatHusks` already warned about it, and a
    // rewrite would be guessing at what the file meant.
    if (!split.hasFrontmatter || fields === null) return false;
    if (fields["origin"] !== undefined) return false;
    fields["origin"] = args.origin.id;
    fields["origin-name"] = args.origin.name;
    // An `engine` already on the card wins — reconcile records, never corrects.
    if (fields["engine"] === undefined) fields["engine"] = args.engine;
    await writeFileAtomic(absPath, { content: renderFrontmatterBlock(fields, split.body) });
    return true;
  });
}

/**
 * Stamp `origin` on every pre-Track-2 husk whose transcript is on THIS
 * machine, and return how many were written.
 *
 * The transcript is the proof: a session's engine store exists on exactly one
 * machine, so two checkouts can never claim the same husk and the stamped sets
 * cannot conflict on merge. A husk with no transcript here is left unset —
 * "unknown" is honest, and inventing an origin would make an expired chat look
 * like it lives somewhere it doesn't.
 */
async function backfillHuskProvenance(boxRoot: string, args: { husks: ChatHuskEntry[]; entries: SessionHistoryEntry[] }): Promise<number> {
  const engineBySession = new Map(args.entries.map((entry) => [entry.id, entry.engine]));
  let stamped = 0;
  for (const husk of args.husks) {
    if (husk.origin !== undefined) continue;
    // The husk's own stamp first, then the history entry; no entry (the file is
    // per-checkout, the husk is not) means `claude`, the same decode a history
    // entry without an `engine` gets.
    const engine = husk.engine ?? engineBySession.get(husk.session) ?? "claude";
    const mtime = await transcriptMtime(boxRoot, { sessionId: husk.session, engine });
    if (mtime === null) continue;
    const origin = await localOrigin();
    if (await stampHuskProvenance(path.join(boxRoot, husk.path), { engine, origin })) stamped += 1;
  }
  return stamped;
}

/**
 * Give every resumable session in the history file a husk. Ghost entries
 * (no transcript on disk) are skipped — nothing to point at.
 *
 * This **reconciles on every boot** rather than running once behind a marker
 * file. Husks are the enumeration for both the picker and the history dropdown
 * (`core/chat/session/list.ts`), so a session with history but no husk is
 * invisible in the UI — and there are two ways to land there that a one-shot
 * migration could never repair: the eager `ensureChatHusk` at session-id
 * assignment is best-effort (`session/registry.ts` logs and continues), and the
 * history backfill that discovers pre-husk sessions runs concurrently with this
 * one, so it could still be writing entries when this pass reads them.
 *
 * Cheap to repeat: one directory listing plus one history read, and per-session
 * work only for the sessions actually missing a husk.
 *
 * It is also where husks written before Track 2 acquire their provenance
 * (`backfillHuskProvenance`): a boot on the machine that holds a session's
 * transcript is exactly when its origin can be established from evidence.
 */
export async function reconcileChatHusks(boxRoot: string): Promise<void> {
  const [entries, husks] = await Promise.all([loadHistoryEntries(boxRoot), listChatHusks(boxRoot)]);
  const bySession = groupHusksBySession(husks);
  // Boot-time visibility for what card-lint reports at commit time. A duplicate
  // is no longer created (ensure is idempotent on the field), but a box can
  // still hold one from before that fix, from a copied card, or a hand-edit —
  // and it would otherwise be silent until someone happened to lint. No repair:
  // which husk to keep is editorial (`core/lint-chat-duplicates.ts`).
  for (const [session, paths] of bySession) {
    if (paths.length < 2) continue;
    console.warn(
      `chat-husk: ${String(paths.length)} husks claim session ${session} (${paths.join(", ")}) — ` +
      "keep one and `cb trash` the others",
    );
  }

  const stamped = await backfillHuskProvenance(boxRoot, { husks, entries });
  // Routine and usually zero, so it says nothing when nothing changed; when it
  // does, it dirtied git-tracked cards and that should be attributable.
  if (stamped > 0) console.debug(`chat-husk: recorded origin on ${String(stamped)} husk(s)`);

  for (const entry of entries) {
    if (bySession.has(entry.id)) continue;
    const mtime = await transcriptMtime(boxRoot, { sessionId: entry.id, engine: entry.engine });
    // Ghost entry — transcript gone; nothing to resume, so no husk.
    if (mtime === null) continue;
    await ensureChatHusk(boxRoot, {
      sessionId: entry.id,
      ...(entry.contextDir !== undefined ? { contextDir: entry.contextDir } : {}),
      engine: entry.engine,
      date: mtime,
    });
  }
}
