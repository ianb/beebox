/**
 * Section handles — stable, cross-referenceable names for the agent guide's
 * sections, derived from the ledger's `registry:` (`ledger.yaml`), so a handle
 * exists in one place.
 *
 * Handles are `UPPER_SNAKE_CASE`: all-caps so they stand out when the model
 * scans, and underscored so a reference reads as one atomic token, a pointer
 * to a named section rather than an emphasized phrase. A heading renders as
 * `## ABOUT_CARDS`; an inline pointer is `xref("ABOUT_CARDS")` →
 * `**ABOUT_CARDS**`; a bare mention is `section("ABOUT_CARDS")`. Both throw on
 * a handle the registry does not list, so a prompt naming a renamed or retired
 * section fails when it is built. To add or rename a handle, edit the
 * registry (docs/agent-guide.md).
 */

import { loadLedger } from "./ledger-schema.js";

class UnknownSectionError extends Error {
  constructor(handle: string) {
    super(`"${handle}" is not a handle in the agent guide's registry (src/core/agent-guide/ledger.yaml)`);
    this.name = "UnknownSectionError";
  }
}

let registered: ReadonlySet<string> | undefined;

/** Every registered handle, in guide order. */
export function sectionHandles(): string[] {
  return loadLedger().registry.map((entry) => entry.handle);
}

/** The handle itself, checked against the registry: a bare in-prose mention. */
export function section(handle: string): string {
  registered ??= new Set(sectionHandles());
  if (!registered.has(handle)) throw new UnknownSectionError(handle);
  return handle;
}

/**
 * Inline cross-reference to a named section: bold, and byte-for-byte the
 * section's heading handle. Use for an explicit "go read that section"
 * pointer; use {@link section} when merely naming the section in prose.
 */
export function xref(handle: string): string {
  return `**${section(handle)}**`;
}
