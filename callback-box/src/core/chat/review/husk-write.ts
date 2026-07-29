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
 * See docs/plans/chat-review.md § Track C.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { renderFrontmatterBlock, splitCardContent } from "../../../cards/index.js";
import { isRecord } from "../../card-io.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { contentHash } from "../../../lib/content-hash.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { scanBundle, type LeakKind } from "../../../publish/leak-scan.js";
import { setDerivedContains } from "../../search/contains-update.js";
import type { ReviewOutput } from "./reviewer.js";
import type { TitleOwner } from "./state.js";

/**
 * Leak kinds that reject a generated string. `external-url` is excluded: a
 * conversation legitimately about a website will name it, and that is not a
 * leak the way an address or a key is.
 */
const REJECTING_KINDS: ReadonlySet<LeakKind> = new Set<LeakKind>([
  "home-path",
  "email",
  "credential",
]);

/** Base class so callers can catch every husk-write failure at once. */
export class HuskWriteError extends Error {
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

class HuskFrontmatterError extends HuskWriteError {
  constructor(relPath: string) {
    super(`chat-review: husk ${relPath} frontmatter is not a YAML mapping`);
    this.name = "HuskFrontmatterError";
  }
}

export interface HuskFields {
  title: string | null;
  account: string | null;
  reviewSpan: string | null;
}

export interface WriteResult {
  titleWritten: boolean;
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
export function renderAccount(notes: ReviewOutput["notes"]): string {
  if (notes.length === 0) return "";
  return notes.map((note) => `- ${note.kind}: ${note.text}`).join("\n");
}

/**
 * Resolve who owns the husk title *now*, re-checked every pass so an edit made
 * before the session was ever reviewed is still honoured.
 */
export function resolveTitleOwner(args: {
  currentTitle: string | null;
  storedOwner: TitleOwner;
  storedHash: string | null;
}): TitleOwner {
  if (args.storedOwner === "manual") return "manual";
  if (args.storedHash === null) {
    // We have never written a title. Whatever is there (nothing, or the
    // first-message snippet ensureChatHusk set) is ours to replace.
    return "unmanaged";
  }
  if (args.currentTitle === null) return "unmanaged";
  return contentHash(args.currentTitle) === args.storedHash ? "generated" : "manual";
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
 * Apply a review to a husk. Title, `review-span` and the derived contains
 * fields land in one locked section so a concurrent in-process writer cannot
 * interleave.
 *
 * Two file writes happen inside the lock: this function sets `title` and
 * `review-span`, then `setDerivedContains` sets `contains`/`contains-evidence`
 * and re-bases the staleness sidecar. Deliberate — it keeps `setDerivedContains`
 * the single place that knows how to keep the sidecar honest, rather than
 * duplicating that logic to save one write.
 */
export async function applyReviewToHusk(
  boxRoot: string,
  args: {
    relPath: string;
    output: ReviewOutput;
    spanId: string;
    currentTitle: string | null;
    storedOwner: TitleOwner;
    storedHash: string | null;
    ownerEmail: string | null;
  },
): Promise<WriteResult> {
  const { relPath, output, spanId, ownerEmail } = args;
  const absPath = path.join(boxRoot, relPath);
  const owner = resolveTitleOwner(args);
  const rejected: string[] = [];

  const account = renderAccount(output.notes);
  const titleOk =
    output.title !== "" && passesLeakScan("title", { text: output.title, ownerEmail });
  if (output.title !== "" && !titleOk) rejected.push("title");
  const containsOk = passesLeakScan("contains", { text: output.contains, ownerEmail });
  if (!containsOk) rejected.push("contains");
  const accountOk = passesLeakScan("contains-evidence", { text: account, ownerEmail });
  if (!accountOk) rejected.push("contains-evidence");

  // Only write a title when the model offered one, it survived the scan, and a
  // human has not taken the field over.
  const writeTitle = titleOk && owner !== "manual";

  return withCardLock(absPath, async () => {
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf8");
    } catch (e) {
      throw new HuskUnreadableError(relPath, { detail: errorMessage(e) });
    }
    const split = splitCardContent(content);
    const parsed: unknown = split.hasFrontmatter ? (parseYaml(split.frontmatterText) ?? {}) : {};
    if (!isRecord(parsed)) {
      throw new HuskFrontmatterError(relPath);
    }
    if (writeTitle) parsed["title"] = output.title;
    parsed["review-span"] = spanId;
    await fs.writeFile(absPath, renderFrontmatterBlock(parsed, split.body));

    await setDerivedContains(boxRoot, {
      relPath,
      ...(containsOk ? { contains: output.contains } : {}),
      ...(accountOk ? { evidence: account } : {}),
    });

    return {
      titleWritten: writeTitle,
      titleOwner: writeTitle ? "generated" : owner,
      titleHash: writeTitle ? contentHash(output.title) : args.storedHash,
      rejected,
    } satisfies WriteResult;
  });
}
