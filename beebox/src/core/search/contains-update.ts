/**
 * Set or confirm a card's `contains` field — the write half of
 * `bbx contains update`. Mutates the card (splitCardContent + YAML, per
 * docs/adding-schemas.md § Mutating), then re-bases the staleness sidecar
 * at the card's live basis. Identical text is the acknowledgment path for
 * a stale flag, so it re-bases too.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { renderFrontmatterBlock, splitCardContent } from "../../cards/index.js";
import { parse as parseYaml } from "yaml";
import { getSearchableTypes } from "../../schemas/registry.js";
import { buildLoadContext } from "../load-context.js";
import { cardTypeFromPath } from "./walk.js";
import { isRecord } from "../card-io.js";
import {
  computeBasisForCardPath,
  loadContainsState,
  saveContainsState,
  rebaseContains,
} from "./contains-state.js";
import { errorMessage } from "../../lib/error-guards.js";

/** Base class so callers can catch every contains-update failure at once. */
export class ContainsUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainsUpdateError";
  }
}

class EmptyContainsTextError extends ContainsUpdateError {
  constructor() {
    super("--text must be a non-empty sentence");
    this.name = "EmptyContainsTextError";
  }
}

class NotACardPathError extends ContainsUpdateError {
  constructor(relPath: string) {
    super(`${relPath} is not a card path (expected Name.<type>.card)`);
    this.name = "NotACardPathError";
  }
}

class NotSearchableKindError extends ContainsUpdateError {
  constructor(kind: string, { validKinds }: { validKinds: string[] }) {
    super(`"${kind}" is not a searchable card type — valid kinds: ${validKinds.join(", ")}`);
    this.name = "NotSearchableKindError";
  }
}

class CardUnreadableError extends ContainsUpdateError {
  constructor(relPath: string, { detail }: { detail: string }) {
    super(`cannot read ${relPath}: ${detail}`);
    this.name = "CardUnreadableError";
  }
}

class NoFrontmatterError extends ContainsUpdateError {
  constructor(relPath: string) {
    super(`${relPath} has no frontmatter block — XML-bodied cards can't carry contains yet`);
    this.name = "NoFrontmatterError";
  }
}

class MalformedFrontmatterError extends ContainsUpdateError {
  constructor(relPath: string) {
    super(`${relPath}'s frontmatter is not a YAML mapping`);
    this.name = "MalformedFrontmatterError";
  }
}

class InvalidAfterUpdateError extends ContainsUpdateError {
  constructor(relPath: string) {
    super(`${relPath} did not validate after the update — check the card with bbx validate`);
    this.name = "InvalidAfterUpdateError";
  }
}

export interface UpdateContainsResult {
  /** True when the card already carried exactly this text (the ack path). */
  unchanged: boolean;
}

/**
 * Write a card's derived contains fields and re-base the staleness sidecar.
 *
 * The shared primitive under both `bbx contains update` and the nightly chat
 * review. It exists because writing `contains-evidence` alone is a real case:
 * an accumulating account grows on a pass where the one-sentence `contains`
 * stays accurate. A "write only when `contains` changed" rule would drop that
 * update silently, so the card is written when *either* field differs.
 *
 * Both fields are optional — omit one to leave it untouched. The sidecar is
 * re-based on every call, including the no-write path, because identical text
 * is the acknowledgment path for a stale flag.
 */
export async function setDerivedContains(
  boxRoot: string,
  {
    relPath,
    contains,
    evidence,
    alsoSet,
  }: {
    relPath: string;
    contains?: string;
    evidence?: string;
    /**
     * Further frontmatter keys to write in the SAME file write. Exists so a
     * caller that must land several fields together — notably chat review,
     * whose `review-span` marker claims the account was updated — cannot end
     * up with a half-applied card if it crashes between two writes.
     */
    alsoSet?: Record<string, string>;
  }
): Promise<UpdateContainsResult> {
  const absPath = path.join(boxRoot, relPath);
  let content: string;
  try {
    content = await fs.readFile(absPath, "utf8");
  } catch (e) {
    throw new CardUnreadableError(relPath, { detail: errorMessage(e) });
  }
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) {
    throw new NoFrontmatterError(relPath);
  }
  const parsedFrontmatter: unknown = parseYaml(split.frontmatterText) ?? {};
  if (!isRecord(parsedFrontmatter)) {
    throw new MalformedFrontmatterError(relPath);
  }
  const fields = parsedFrontmatter;
  const containsChanged = contains !== undefined && fields["contains"] !== contains;
  const evidenceChanged = evidence !== undefined && fields["contains-evidence"] !== evidence;
  const extras = Object.entries(alsoSet ?? {});
  const extrasChanged = extras.some(([key, value]) => fields[key] !== value);
  const unchanged = !containsChanged && !evidenceChanged && !extrasChanged;
  if (!unchanged) {
    if (containsChanged) fields["contains"] = contains;
    if (evidenceChanged) fields["contains-evidence"] = evidence;
    for (const [key, value] of extras) fields[key] = value;
    await fs.writeFile(absPath, renderFrontmatterBlock(fields, split.body));
  }

  // Re-base against whatever `contains` the card now carries — which is the
  // caller's text when they set one, and the card's existing text when they
  // only extended the evidence.
  const ctx = await buildLoadContext(boxRoot);
  const { basis, contains: liveContains } = await computeBasisForCardPath(boxRoot, { relPath, ctx });
  if (basis === null || (contains !== undefined && liveContains !== contains)) {
    throw new InvalidAfterUpdateError(relPath);
  }
  const state = await loadContainsState(boxRoot);
  rebaseContains(state, { cardPath: relPath, contains: liveContains, basis });
  await saveContainsState(boxRoot, state);
  return { unchanged };
}

/**
 * `bbx contains update`'s entry point: the CLI-shaped guards (non-empty text,
 * a real card path, a searchable card type) in front of
 * {@link setDerivedContains}. Kept as a thin wrapper so there is one write
 * path and the two cannot disagree about the sidecar.
 */
export async function updateContainsField(
  boxRoot: string,
  { relPath, text }: { relPath: string; text: string }
): Promise<UpdateContainsResult> {
  if (text.trim() === "") {
    throw new EmptyContainsTextError();
  }
  const kind = cardTypeFromPath(relPath);
  if (kind === undefined) {
    throw new NotACardPathError(relPath);
  }
  const searchable = await getSearchableTypes(boxRoot);
  if (!searchable.includes(kind)) {
    throw new NotSearchableKindError(kind, { validKinds: searchable.toSorted() });
  }
  return setDerivedContains(boxRoot, { relPath, contains: text });
}
