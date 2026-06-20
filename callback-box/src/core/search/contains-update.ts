/**
 * Set or confirm a card's `contains` field — the write half of
 * `cb contains update`. Mutates the card (splitCardContent + YAML, per
 * docs/adding-schemas.md § Mutating), then re-bases the staleness sidecar
 * at the card's live basis. Identical text is the acknowledgment path for
 * a stale flag, so it re-bases too.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { splitCardContent } from "../../cards/index.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { getSearchableTypes } from "../../schemas/registry.js";
import { buildLoadContext } from "../load-context.js";
import { cardTypeFromPath } from "./walk.js";
import {
  computeBasisForCardPath,
  loadContainsState,
  saveContainsState,
  rebaseContains,
} from "./contains-state.js";

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

class InvalidAfterUpdateError extends ContainsUpdateError {
  constructor(relPath: string) {
    super(`${relPath} did not validate after the update — check the card with cb validate`);
    this.name = "InvalidAfterUpdateError";
  }
}

export interface UpdateContainsResult {
  /** True when the card already carried exactly this text (the ack path). */
  unchanged: boolean;
}

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

  const absPath = path.join(boxRoot, relPath);
  let content: string;
  try {
    content = await fs.readFile(absPath, "utf8");
  } catch (e) {
    throw new CardUnreadableError(relPath, { detail: (e as Error).message });
  }
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) {
    throw new NoFrontmatterError(relPath);
  }
  const fields = (parseYaml(split.frontmatterText) ?? {}) as Record<string, unknown>;
  const unchanged = fields["contains"] === text;
  if (!unchanged) {
    fields["contains"] = text;
    await fs.writeFile(absPath, `---\n${stringifyYaml(fields)}---\n${split.body}`);
  }

  const ctx = await buildLoadContext(boxRoot);
  const { basis, contains } = await computeBasisForCardPath(boxRoot, { relPath, ctx });
  if (basis === null || contains !== text) {
    throw new InvalidAfterUpdateError(relPath);
  }
  const state = await loadContainsState(boxRoot);
  rebaseContains(state, { cardPath: relPath, contains: text, basis });
  await saveContainsState(boxRoot, state);
  return { unchanged };
}
