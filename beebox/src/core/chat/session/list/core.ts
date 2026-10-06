/**
 * The one enumeration of "which web chats exist".
 *
 * Husk cards are the source of truth (docs/plans/chat-husks.md) — the cards
 * say which sessions exist and what they're called, so deleting a husk is
 * editorial removal from every list. Activity stays runtime-derived: freshness
 * is the transcript's mtime, and a husk whose transcript is gone is skipped
 * here (nothing to resume) while staying browsable as a card.
 *
 * Extracted from `webapp/trpc/routers/chat.ts` so the history dropdown
 * (`chat.sessions`) and the landmark picker (`chat.byLandmark`) enumerate the
 * same set. The dropdown used to read the history JSON instead, so a deleted
 * husk vanished from the picker but lingered in the dropdown.
 */

import * as fs from "node:fs/promises";
import { findChatHuskEntry, listChatHusks, type ChatHuskEntry } from "../../husk-read.js";
import { huskTranscriptPath } from "../../husk-transcript.js";
import { quoteSnippet, resolveSessionLabel, type SessionLabelSource } from "./label.js";
import { assertNever } from "../../../../shared/invariant.js";
import { errnoCode } from "../../../../shared/error-guards.js";
import { mapInBatches, mapInBatchesSettled } from "../../../../lib/map-batched.js";
import { loadHistoryEntries } from "../history.js";
import { resolveChatEngine } from "../engine.js";
import { deriveTranscriptState, type TranscriptState } from "../availability.js";
import { listCodexThreadMetadata, type CodexThreadMetadata } from "../codex-transcript/core.js";
import { containedSessionCwd } from "../transcript-paths.js";
import type { AgentEngine } from "../../../box/config.js";

/**
 * Chats resolved at once — see {@link mapInBatchesSettled}. `resolveSessionLabel`
 * absorbs its own failures (it falls back to the id prefix), so the labelling
 * pass can use the plain `mapInBatches`.
 */
const READ_CONCURRENCY = 64;

/**
 * A chat's *identity and activity* — everything derivable from its husk card
 * plus one `stat`. Deliberately unlabeled: naming a chat can cost a transcript
 * read, and a caller that only counts chats must not pay for names it discards.
 */
export interface ChatSessionEntry {
  sessionId: string;
  engine: AgentEngine;
  /** "" for root-bound, undefined for legacy unbound (treated as root). */
  contextDir: string | undefined;
  mtime: Date;
  /** Box-relative path of the session's husk card. */
  huskPath: string;
  /**
   * Absolute transcript path. Carried rather than recomputed: the enumeration
   * already resolved it to `stat` the file, and labelling would otherwise
   * re-derive it. Host-side only — never forwarded to a client.
   */
  logPath: string;
  /** The husk's editorial `title`, when it has one. Free — it rode the husk. */
  title: string | undefined;
  /** The boxholder's close mark (`done: true`) — a done chat sorts below live ones. */
  done: boolean;
  /**
   * The Codex thread's verbatim first user message, envelope and all, as
   * `thread/list` reports it. Free — one list call already carries it for every
   * thread — and it's what stands in for a transcript scan when labelling.
   */
  nativePreview?: string | undefined;
}

/** A chat as a *list* shows it — an entry plus its display name. */
export interface ChatSessionRow extends ChatSessionEntry {
  label: string;
}

/**
 * A husk whose transcript is not on this machine — a chat that still exists as
 * a card but has nothing left to resume.
 *
 * Deliberately not a `ChatSessionEntry`: it has no mtime (the transcript that
 * carried activity is gone) and no engine worth reporting, and every field it
 * does carry rode the husk. Its rows link to the card, never to `/chat?session=`.
 */
export interface DeadHuskEntry {
  sessionId: string;
  /** Box-relative path of the husk card. */
  huskPath: string;
  /** "" for root-bound, undefined for legacy unbound (treated as root). */
  contextDir: string | undefined;
  /** The husk's editorial `title`, when it has one. */
  title: string | undefined;
  /**
   * The husk's stored opening snippet (`first-message`), when it has one —
   * for a dead husk the only surviving trace of what the conversation opened
   * with, displayed quoted rather than as if it were a title.
   */
  firstMessage: string | undefined;
  /**
   * Why there is nothing to resume. Never `present` — that is what makes the
   * husk dead, and it is the enumeration's job to keep the two lists disjoint.
   */
  transcript: TranscriptState;
}

/**
 * One enumeration, two answers. Which husks are live and which are dead is the
 * *same* question — one husk read and one `stat` each — so asking it twice
 * would double the I/O of every surface that shows both.
 */
interface ChatEnumeration {
  live: ChatSessionEntry[];
  dead: DeadHuskEntry[];
}

/**
 * Every resumable web chat, most-recently-active first, **without labels**.
 *
 * This is the cheap enumeration: one husk read and one `stat` per chat, no
 * transcript I/O. Use it whenever you need to know *which* chats exist, where
 * they're bound, or how recently they were touched — grouping, counting,
 * freshness — and reach for `loadAllSessions` only when rows will actually be
 * rendered with names.
 *
 * Husks are resolved concurrently, not in sequence: the app bar's place menu
 * waits on the whole set. `allSettled` per code-style — one husk's failure is
 * already a per-husk skip, and must not abandon the others.
 *
 * `repairCodexIndex: false` skips Codex's rollout repair scan (see
 * `listCodexThreadMetadata`), so a Codex chat missing from Codex's thread index
 * is left out instead of looked for. For callers that only count recent
 * activity, such as the app bar's place menu: the scan can take tens of
 * seconds, and the threads it finds are old ones.
 */
export async function listSessionEntries(
  boxRoot: string,
  options?: { repairCodexIndex?: boolean },
): Promise<ChatSessionEntry[]> {
  return (await enumerateChats(boxRoot, { repairCodexIndex: options?.repairCodexIndex ?? true })).live;
}

/**
 * Every husk with no transcript on this machine, newest first.
 *
 * The sibling of `listSessionEntries` — same pass, the other half of the
 * answer. Husk filenames lead with the chat's date, so sorting on the path
 * orders these by when the chat happened; there is no mtime left to sort on.
 */
export async function loadDeadHusks(boxRoot: string): Promise<DeadHuskEntry[]> {
  return (await enumerateChats(boxRoot, { repairCodexIndex: true })).dead;
}

/**
 * Codex's view of its own threads, or `null` when Codex couldn't answer.
 *
 * A degradation rather than a failure. For a codex chat this metadata is not
 * decoration — it carries the chat's existence as well as its date, so losing
 * it means losing those chats from the listing entirely, counts included. That
 * is still the better trade: when the Codex CLI is broken (the plugin
 * marketplace pointing at a deleted checkout is the case that prompted this),
 * the honest answer is that those chats are unavailable — not that the whole
 * enumeration failed, which took the app bar's place menu down with it.
 *
 * The catch is deliberately wide. "Codex couldn't answer" is one recoverable
 * class from the caller's side whether the CLI is missing, its registration is
 * broken, or its reply no longer matches the schema — the listing can do
 * nothing about any of them, and the warning names the cause either way.
 */
async function readCodexThreads(
  boxRoot: string,
  options: { codexHusks: ChatHuskEntry[]; repair: boolean },
): Promise<Map<string, CodexThreadMetadata> | null> {
  const { codexHusks, repair } = options;
  if (codexHusks.length === 0) return new Map();
  // Contained, like every other resolution of a husk's `context-dir`: the
  // field is a card value, and an escaping one reads from the box root.
  const cwds = new Set(codexHusks.map((husk) => containedSessionCwd(boxRoot, husk.contextDir)));
  try {
    return await listCodexThreadMetadata(boxRoot, {
      cwds: [...cwds],
      expectedIds: codexHusks.map((husk) => husk.session),
      repair,
    });
  } catch (error) {
    console.warn("[chat] codex thread metadata unavailable; omitting this box's codex chats:", error);
    return null;
  }
}

/** The single husk-read-and-stat pass behind both enumerations. */
async function enumerateChats(boxRoot: string, options: { repairCodexIndex: boolean }): Promise<ChatEnumeration> {
  const [husks, history] = await Promise.all([listChatHusks(boxRoot), loadHistoryEntries(boxRoot)]);
  const historyById = new Map(history.map((entry) => [entry.id, entry]));
  // Resolved once per husk, up front: which engine ran a chat decides both
  // which store to look in and whether its thread metadata has to be fetched,
  // and `resolveChatEngine` is the only place that order is written down.
  const engines = new Map(await mapInBatches(husks, {
    size: READ_CONCURRENCY,
    map: async (husk) => [husk.session, await resolveChatEngine(boxRoot, {
      sessionId: husk.session,
      husk,
      historyEngine: historyById.get(husk.session)?.engine ?? null,
    })] as const,
  }));
  const codexThreads = await readCodexThreads(boxRoot, {
    codexHusks: husks.filter((husk) => engines.get(husk.session) === "codex"),
    repair: options.repairCodexIndex,
  });
  const settled = await mapInBatchesSettled(husks, {
    size: READ_CONCURRENCY,
    map: (husk) => resolveHusk({
      boxRoot,
      husk,
      engine: engines.get(husk.session) ?? "claude",
      codexMetadata: codexThreads?.get(husk.session),
      codexAvailable: codexThreads !== null,
    }),
  });
  const live: ChatSessionEntry[] = [];
  const dead: DeadHuskEntry[] = [];
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.warn(`[chat] husk ${husks[i]?.path}: could not resolve session:`, outcome.reason);
      continue;
    }
    const resolved = outcome.value;
    switch (resolved.kind) {
      case "live":
        live.push(resolved.entry);
        break;
      case "dead":
        dead.push(resolved.entry);
        break;
      case "unreadable":
        // Already warned about, and claimed by neither list: "the transcript is
        // gone" and "the transcript is unreadable" are different facts, and the
        // dead list exists to state the first one truthfully.
        break;
      default:
        assertNever(resolved);
    }
  }
  live.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  dead.sort((a, b) => b.huskPath.localeCompare(a.huskPath));
  return { live, dead };
}

/**
 * Every resumable web chat, most-recently-active first, each with the label a
 * list shows (husk `title`, then the transcript's first user message, then the
 * id prefix). The naming half is what costs I/O — see `listSessionEntries` for
 * the enumeration on its own.
 */
export async function loadAllSessions(boxRoot: string): Promise<ChatSessionRow[]> {
  return labelEntries(await listSessionEntries(boxRoot));
}

/**
 * Both lists at once, for the surfaces that show live chats *and* the dead
 * husks underneath them. One enumeration: asking `loadAllSessions` and
 * `loadDeadHusks` separately would read every husk and stat every transcript
 * twice for one page.
 */
export async function loadChatLists(boxRoot: string): Promise<{ sessions: ChatSessionRow[]; dead: DeadHuskEntry[] }> {
  const { live, dead } = await enumerateChats(boxRoot, { repairCodexIndex: true });
  return { sessions: await labelEntries(live), dead };
}

/**
 * A dead chat's display name, in the same order a live one's resolves — minus
 * the transcript scan, because the transcript is exactly what is gone. The
 * stored opening snippet renders quoted (a snippet, not a title); the id
 * prefix is the last resort.
 */
export function deadHuskLabel(husk: DeadHuskEntry): string {
  if (husk.title !== undefined && husk.title !== "") return husk.title;
  if (husk.firstMessage !== undefined && husk.firstMessage !== "") return quoteSnippet(husk.firstMessage);
  return husk.sessionId.slice(0, 8);
}

async function labelEntries(entries: ChatSessionEntry[]): Promise<ChatSessionRow[]> {
  // An untitled chat's label comes from a full transcript scan, so this is one
  // open stream per unlabelled chat and a box's chat count only ever grows.
  // Memoized on (transcript path, mtime) — a re-listing then rescans only the
  // transcripts that actually changed since the last one.
  return mapInBatches(entries, {
    size: READ_CONCURRENCY,
    map: async (entry) => ({ ...entry, label: await labelFor(entry) }),
  });
}

/**
 * Cached labels, keyed by transcript path + mtime. Bounded so a long-lived
 * server can't accumulate one entry per chat it has ever listed; eviction is
 * insertion order (a Map iterates oldest-first), which is close enough to LRU
 * for a cache whose miss costs one file scan.
 */
const LABEL_CACHE_MAX = 2000;
const labelCache = new Map<string, string>();

async function labelFor(entry: ChatSessionEntry): Promise<string> {
  // Only the transcript source is worth caching: a title rode the husk, and a
  // Codex preview came free with the thread listing.
  if (entry.title !== undefined && entry.title !== "") return entry.title;
  const source = labelSource(entry);
  if (source.kind !== "transcript") {
    return resolveSessionLabel({ sessionId: entry.sessionId, title: entry.title, source });
  }
  const key = `${source.logPath}\0${entry.mtime.getTime()}`;
  const cached = labelCache.get(key);
  if (cached !== undefined) return cached;
  const label = await resolveSessionLabel({ sessionId: entry.sessionId, title: entry.title, source });
  if (labelCache.size >= LABEL_CACHE_MAX) {
    const oldest = labelCache.keys().next();
    if (!oldest.done) labelCache.delete(oldest.value);
  }
  labelCache.set(key, label);
  return label;
}

/**
 * Where this chat's first user message is read from — the only per-engine part
 * of naming a chat (the order and the wrapper-stripping are the resolver's).
 *
 * A `switch` over the engine rather than a boolean: a third engine must fail to
 * compile here and state its own source, instead of silently inheriting
 * whichever branch the ternary fell through to. That silent inheritance is the
 * shape of the bug this replaced.
 */
export function labelSource(entry: ChatSessionEntry): SessionLabelSource {
  switch (entry.engine) {
    case "codex":
      // Present whenever the enumeration kept the chat: a Codex husk whose
      // thread metadata is missing is dropped above, before labelling.
      return { kind: "preview", text: entry.nativePreview };
    case "claude":
      return { kind: "transcript", logPath: entry.logPath };
    default:
      return assertNever(entry.engine);
  }
}

/**
 * What one husk turned out to be. Three outcomes, not two: a transcript that
 * is *absent* makes a dead chat, while one that is present-but-unreadable
 * (EACCES, EIO) is a fact this enumeration cannot establish either way.
 */
type HuskResolution =
  | { kind: "live"; entry: ChatSessionEntry }
  | { kind: "dead"; entry: DeadHuskEntry }
  | { kind: "unreadable" };

async function deadHusk(husk: ChatHuskEntry): Promise<HuskResolution> {
  return {
    kind: "dead",
    entry: {
      sessionId: husk.session,
      huskPath: husk.path,
      contextDir: husk.contextDir,
      title: husk.title,
      firstMessage: husk.firstMessage,
      transcript: await deriveTranscriptState({ husk, present: false }),
    },
  };
}

/** Resolve one husk against this machine's transcript store. */
async function resolveHusk(options: {
  boxRoot: string;
  husk: ChatHuskEntry;
  engine: AgentEngine;
  codexMetadata: CodexThreadMetadata | undefined;
  /** False when Codex itself couldn't be asked — see `readCodexThreads`. */
  codexAvailable: boolean;
}): Promise<HuskResolution> {
  const { boxRoot, husk, engine, codexMetadata, codexAvailable } = options;
  const logPath = huskTranscriptPath(boxRoot, husk);
  let mtime: Date;
  try {
    if (engine === "codex") {
      // "Codex couldn't be asked" and "Codex has no such thread" are different
      // facts: the second is a dead husk, the first is one we can't classify,
      // so it goes in neither list rather than being reported as expired.
      if (!codexAvailable) return { kind: "unreadable" };
      if (codexMetadata === undefined) return await deadHusk(husk);
      mtime = codexMetadata.updatedAt;
    } else {
      mtime = (await fs.stat(logPath)).mtime;
    }
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      // Not "the transcript was cleaned up" — the file may well be there and
      // unreadable (EACCES, EIO). Say so loudly rather than silently, and don't
      // let the dead list report it as expired.
      console.warn(`[chat] husk ${husk.path}: transcript unreadable, omitting session:`, e);
      return { kind: "unreadable" };
    }
    return deadHusk(husk);
  }

  return {
    kind: "live",
    entry: {
      sessionId: husk.session,
      engine,
      contextDir: husk.contextDir,
      mtime,
      huskPath: husk.path,
      logPath,
      title: husk.title,
      done: husk.done === true,
      ...(codexMetadata === undefined ? {} : { nativePreview: codexMetadata.preview }),
    },
  };
}

/**
 * One session's display label, resolved the way `loadAllSessions` resolves a
 * row's — husk `title`, then the transcript's first user message, then the id
 * prefix — but for a single known id, so the chat page's bootstrap doesn't pay
 * for enumerating every chat in the box just to name the one it's showing.
 *
 * A session with no husk still gets a label: a brand-new chat is named from its
 * transcript, and an id with neither is named from its prefix (not an error —
 * `chat.bootstrap` already treats a transcript-less id as a normal state).
 */
/**
 * Whether the boxholder has marked this session done (`done: true` on its
 * husk), or null when the session has no husk — a brand-new chat has no card
 * to mark, so a caller offering the toggle must offer nothing.
 */
export async function sessionIsDone(boxRoot: string, sessionId: string): Promise<boolean | null> {
  const husk = await findChatHuskEntry(boxRoot, sessionId);
  return husk === null ? null : husk.done === true;
}

/**
 * The session's *editorial* title — the husk card's `title`, or null when
 * the session has none (yet). Deliberately no first-message/id fallback:
 * those fabrications are fine as picker-row labels where every row must be
 * distinguishable, but the app bar's session chip shows a title only when a
 * real one exists (the nightly chat review or a hand edit names it) and an
 * icon face otherwise.
 */
export async function titleForSession(boxRoot: string, sessionId: string): Promise<string | null> {
  const husk = await findChatHuskEntry(boxRoot, sessionId);
  const title = husk?.title;
  return title === undefined || title === "" ? null : title;
}
