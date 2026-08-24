/**
 * Writing a review's output back to a husk card.
 *
 * Four fields move: `title` (only when we still own it), `contains`,
 * `contains-evidence` (the running account), and `review-span` (the
 * idempotency marker naming the last span folded in).
 *
 * Every generated string is leak-scanned first. The scan catches mechanical
 * leaks only — `publish/leak-scan.ts` says so itself: it *"does NOT
 * meaningfully cover"* PII *"in prose form"*. A title that accurately names a
 * private topic passes it. The prompt, the husk view, and the boxholder's
 * ability to edit are the real controls.
 *
 * See docs/implemented-plans/chat-review.md § Track C.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../../../cards/index.js";
import { isRecord } from "../../card-io.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { contentHash } from "../../../lib/content-hash.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { scanBundle, type LeakKind } from "../../../publish/leak-scan.js";
import { setDerivedContains } from "../../search/contains-update.js";
import type { ReviewOutput } from "./reviewer.js";
import type { TitleOwner } from "./state.js";

/**
 * What rejects a generated string.
 *
 * **Only a credential.** That is secret hygiene, not editorial judgement — an
 * API key in a git-tracked card is a problem no matter who reads it or which
 * field it landed in.
 *
 * An earlier version also rejected emails and home paths from titles, on the
 * theory that a title is a semi-public surface. That was the wrong model. The
 * thing to keep out of a title is anything that would *embarrass* someone
 * reading it over the boxholder's shoulder — and no regex detects that, while
 * names, addresses and figures are all perfectly fine in a title. So the
 * editorial judgement lives entirely in the prompt, where it can be exercised,
 * rather than half here in a filter that catches the wrong things.
 */
const REJECTING_KINDS: ReadonlySet<LeakKind> = new Set<LeakKind>(["credential"]);

/** Base class so callers can catch every husk-write failure at once. */
class HuskWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HuskWriteError";
  }
}

class HuskUnreadableError extends HuskWriteError {
  constructor(relPath: string, { detail }: { detail: string }) {
    super(`chat-review: cannot read husk ${relPath}: ${detail}`);
    this.name = "HuskUnreadableError";
  }
}

export interface HuskFields {
  title: string | null;
  account: string | null;
  reviewSpan: string | null;
}

export interface WriteResult {
  titleWritten: boolean;
  /** True when the span was fully applied and the marker written. */
  spanApplied: boolean;
  /** New owner after the write — `manual` when a hand-edit was detected. */
  titleOwner: TitleOwner;
  /** sha256 of the title now on the card, or null when it has none. */
  titleHash: string | null;
  /** Fields dropped by the leak scan, for the run report. */
  rejected: string[];
}

/** Read the fields chat review cares about off a husk card. */
export async function readHuskFields(boxRoot: string, relPath: string): Promise<HuskFields> {
  const content = await fs.readFile(path.join(boxRoot, relPath), "utf8");
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return { title: null, account: null, reviewSpan: null };
  const parsed: unknown = parseYaml(split.frontmatterText) ?? {};
  if (!isRecord(parsed)) return { title: null, account: null, reviewSpan: null };
  const str = (key: string): string | null => {
    const value = parsed[key];
    return typeof value === "string" && value !== "" ? value : null;
  };
  return {
    title: str("title"),
    account: str("contains-evidence"),
    reviewSpan: str("review-span"),
  };
}

/** Render the model's kinded notes into the markdown the account field holds. */
function renderAccount(notes: ReviewOutput["notes"]): string {
  if (notes.length === 0) return "";
  return notes.map((note) => `- ${note.kind}: ${note.text}`).join("\n");
}

/**
 * Resolve who owns the husk title *now*.
 *
 * Re-derived on every pass rather than trusted from state, so a hand edit is
 * honoured however it arrived. The subtle case is the FIRST review: state has
 * no hash yet, but the husk may already carry a title — either the
 * first-message snippet `ensureChatHusk` wrote, or something the boxholder
 * typed. Those must be told apart, or we either never improve auto-titles or
 * silently clobber human ones. The snippet is reproducible, so comparing
 * against it is the discriminator.
 */
export function resolveTitleOwner(args: {
  currentTitle: string | null;
  /** What `ensureChatHusk` would have derived from the transcript, if anything. */
  snippetTitle: string | null;
  storedOwner: TitleOwner;
  storedHash: string | null;
}): TitleOwner {
  if (args.storedOwner === "manual") return "manual";
  if (args.currentTitle === null) return "unmanaged";
  if (args.storedHash !== null) {
    return contentHash(args.currentTitle) === args.storedHash ? "generated" : "manual";
  }
  // First review. An untouched snippet title is ours to replace; anything else
  // on the card was put there by a person.
  return args.currentTitle === args.snippetTitle ? "unmanaged" : "manual";
}

/** True when the string is clean enough to commit. Rejections are reported, not silent. */
function passesLeakScan(field: string, args: { text: string; ownerEmail: string | null }): boolean {
  const { text, ownerEmail } = args;
  if (text === "") return true;
  const result = scanBundle(new Map([[field, text]]), { ownerEmail, allowedEmails: [] });
  const blocking = result.findings.filter((f) => REJECTING_KINDS.has(f.kind));
  for (const finding of blocking) {
    console.warn(
      `chat-review: dropped generated ${field} — leak scan found ${finding.kind} (${finding.detail})`,
    );
  }
  return blocking.length === 0;
}

/**
 * Apply a review to a husk, in a single card write.
 *
 * Everything the pass produces — `title`, `contains`, `contains-evidence` and
 * the `review-span` marker — lands in one write, because `review-span` is the
 * claim that the account was extended. Written separately (or first), a crash
 * in between would leave the marker without the account, and the next run would
 * see the marker, believe the span was folded in, and skip it forever.
 *
 * For the same reason the marker is written ONLY when every generated field
 * survived the leak scan. A rejected account means the span was not folded in,
 * so it must stay unclaimed and be retried.
 *
 * The husk is re-read under the lock and title ownership resolved from that
 * live value, never from the snapshot discovery took — the model call in
 * between is long enough for a person to retitle the chat.
 */
export async function applyReviewToHusk(
  boxRoot: string,
  args: {
    relPath: string;
    output: ReviewOutput;
    spanId: string;
    /** What `ensureChatHusk` would derive from the transcript; see resolveTitleOwner. */
    snippetTitle: string | null;
    storedOwner: TitleOwner;
    storedHash: string | null;
    ownerEmail: string | null;
  },
): Promise<WriteResult> {
  const { relPath, output, spanId, ownerEmail } = args;
  const absPath = path.join(boxRoot, relPath);
  const rejected: string[] = [];

  const account = renderAccount(output.notes);
  const titleOffered = output.title !== "";
  const titleClean =
    titleOffered
    && passesLeakScan("title", { text: output.title, ownerEmail });
  if (titleOffered && !titleClean) rejected.push("title");
  const containsOk = passesLeakScan("contains", { text: output.contains, ownerEmail });
  if (!containsOk) rejected.push("contains");
  const accountOk = passesLeakScan("contains-evidence", { text: account, ownerEmail });
  if (!accountOk) rejected.push("contains-evidence");

  return withCardLock(absPath, async () => {
    const live = await readHuskFields(boxRoot, relPath).catch((e: unknown) => {
      throw new HuskUnreadableError(relPath, { detail: errorMessage(e) });
    });
    const owner = resolveTitleOwner({
      currentTitle: live.title,
      snippetTitle: args.snippetTitle,
      storedOwner: args.storedOwner,
      storedHash: args.storedHash,
    });
    const writeTitle = titleClean && owner !== "manual";

    // The span counts as folded in only if the account it produced was written.
    const spanApplied = rejected.length === 0;

    await setDerivedContains(boxRoot, {
      relPath,
      ...(containsOk ? { contains: output.contains } : {}),
      ...(accountOk ? { evidence: account } : {}),
      alsoSet: {
        ...(writeTitle ? { title: output.title } : {}),
        ...(spanApplied ? { "review-span": spanId } : {}),
      },
    });

    return {
      titleWritten: writeTitle,
      titleOwner: writeTitle ? "generated" : owner,
      titleHash: writeTitle ? contentHash(output.title) : (owner === "manual" ? null : args.storedHash),
      spanApplied,
      rejected,
    } satisfies WriteResult;
  });
}
