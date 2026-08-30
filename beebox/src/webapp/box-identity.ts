/**
 * Box-aware request identity: `resolveRequestIdentity` plus one rung the box
 * itself opts into.
 *
 * The browse key (`core/browse-key.ts`) is machine-wide and deliberately
 * nobody, so every owner-gated surface — capture, pairing, most of Settings,
 * every `ownerProcedure`, chat attribution — is unreachable or wrong for
 * exactly the sessions that exist to drive the app (`bin/browse`, tours,
 * journey walks). A box BUILT for that use declares `agentBrowsing: "owner"`
 * in its `config/box.json`, and inside that box the key resolves to the
 * owner's identity. A box that never said so keeps today's fence.
 *
 * Every box-scoped reader of identity calls this, not `resolveRequestIdentity`
 * directly — the key's meaning used to be decided in three places (the box
 * wall, the tRPC context, and by omission in capture/chat-send), and none of
 * them could say "for this box, the owner". Design:
 * `docs/plans/agent-browsing-owner.md`.
 */

import { loadBoxConfig } from "../core/box/config.js";
import { verifyBrowseKey } from "../core/browse-key.js";
import {
  getOwnerEmail,
  localUserName,
  resolveRequestIdentity,
  type IdentityRequest,
  type RequestIdentity,
} from "./auth.js";

/**
 * Boxes already warned about, keyed by box AND kind of problem: a box can hit
 * one and later the other (a bad value corrected to `"owner"` on a deployment
 * with no owner yet), and one warning must not silence the next.
 */
const warnedBoxes = new Set<string>();

/** The warn-once key for one box and one kind of problem. */
function warnKey(kind: "bad-value" | "no-owner", boxRoot: string): string {
  return `${kind}\u0000${boxRoot}`;
}

function warnOnce(key: string, message: string): void {
  if (warnedBoxes.has(key)) return;
  warnedBoxes.add(key);
  console.warn(message);
}

/**
 * Does this box declare that agent browsing acts as its owner?
 *
 * The value is read narrowly (`=== "owner"`): `config/box.json` is disk, so any
 * other value is treated as absent and warned about, naming the box and the
 * value. The loader's own `{}`-on-corrupt behaviour means a broken config
 * disables the rung, never enables it.
 */
async function boxGrantsBrowseOwner(boxRoot: string): Promise<boolean> {
  const config = await loadBoxConfig(boxRoot);
  const value: unknown = config.agentBrowsing;
  if (value === undefined) return false;
  if (value === "owner") return true;
  warnOnce(
    warnKey("bad-value", boxRoot),
    `[box-identity] Ignoring agentBrowsing: ${JSON.stringify(value)} in ${boxRoot}/config/box.json — the only supported value is "owner".`,
  );
  return false;
}

/**
 * Resolve a request's identity for one box.
 *
 * In order: a real identity (`hub`/`cookie`) wins; `open` wins; `unavailable`
 * is returned as-is (the browse key must NEVER mask a corrupt credential store
 * — that path fails closed with a 503); then the browse rung, which needs all
 * three of a valid key, the box's opt-in, and a local owner to bind to; else
 * the unauthenticated identity the base resolver produced.
 */
export async function resolveBoxIdentity(opts: {
  boxRoot: string;
  request: IdentityRequest;
  openAccess: boolean;
}): Promise<RequestIdentity> {
  const identity = resolveRequestIdentity(opts.request, { openAccess: opts.openAccess });
  if (identity.email !== null) return identity;
  if (identity.source === "open" || identity.source === "unavailable") return identity;
  if (!verifyBrowseKey(opts.request.headers)) return identity;
  if (!(await boxGrantsBrowseOwner(opts.boxRoot))) return identity;
  const owner = getOwnerEmail();
  if (owner === null) {
    warnOnce(
      warnKey("no-owner", opts.boxRoot),
      `[box-identity] ${opts.boxRoot} sets agentBrowsing: "owner", but this deployment has no owner to act as; agent browsing stays unauthenticated.`,
    );
    return identity;
  }
  return { email: owner, name: localUserName(owner) ?? owner, source: "browse" };
}
