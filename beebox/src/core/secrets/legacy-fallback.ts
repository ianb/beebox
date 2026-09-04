/**
 * The one rule every migrated reader shares: WHEN may a store refusal fall
 * through to the legacy in-tree file or env var?
 *
 * Only for `unknown-secret` — no entry of that name exists on this machine at
 * all, which is exactly the unmigrated-box case the transition window exists
 * for. Every other refusal FAILS CLOSED.
 *
 * The reason is revocation. If `not-granted` fell through, `bbx secrets revoke`
 * would be a no-op on any box whose legacy `_config/connectors/<name>.secret.json`
 * (or exported env var) still exists — the boxholder would withdraw a grant,
 * see the revoke succeed, and the connector would keep working off the stale
 * file. The same argument covers the rest: `agent-access-not-granted` is a
 * deliberate ceiling on disclosure, `store-unreadable` is a machine-wide fault
 * where falling back would silently resurrect credentials the store was meant to
 * supersede, and `empty-slot`/`dangling-grant` are states the boxholder created
 * on purpose and needs to see rather than have papered over.
 *
 * The refusal is already in the access log with its exact condition, but a
 * connector that goes quiet needs to be explainable from the process output
 * alone — hence one warning per reader per kind, naming the kind and carrying
 * the refusal's own relay-ready message.
 */

import type { SecretRefusal } from "./errors.js";

/** `<reader>:<kind>` pairs already warned about in this process. */
const warned = new Set<string>();

/**
 * May `reader` fall through to its legacy file/env source after this refusal?
 *
 * `reader` is the log prefix the caller already uses (`mistral-key`, `telegram`,
 * …), so the warning reads like the rest of that module's output.
 */
export function refusalAllowsLegacyFallback(opts: { reader: string; refusal: SecretRefusal }): boolean {
  if (opts.refusal.kind === "unknown-secret") return true;
  const key = `${opts.reader}:${opts.refusal.kind}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(
      `[${opts.reader}] not configured (${opts.refusal.kind}) — refusing to fall back to a legacy ` +
        "secret file or environment variable, which would make a revoked or withheld grant a no-op. " +
        opts.refusal.message,
    );
  }
  return false;
}

/** Reset the once-per-process warning latch (tests only). */
export function resetLegacyFallbackWarnings(): void {
  warned.clear();
}
