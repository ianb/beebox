/**
 * The hub's per-box credential checks: a mobile device, a scan uploader, the
 * box's own agent, and the box's own browser pass. Each used to be verified against the box's secret store on
 * disk. On a unit host the hub runs outside every box's group and reads only
 * what the box publishes for it (`core/hub-meta.ts`): SHA-256 hashes of the
 * live tokens. A bearer is hashed and compared; a junk bearer is refused here
 * and never wakes a sleeping box. The box still verifies on its own routes.
 *
 * Which source applies is the one process-wide switch `enableHubMetaReads`
 * (`cli/commands/hub.ts` flips it on a unit host). A hub that spawns its own
 * children keeps the direct reads these functions always did.
 *
 * The mobile COOKIE is signed with a key the box does not publish. On a unit
 * host that key is derived from the box's hub secret (`core/mobile/session.ts`,
 * `deriveMobileSessionKey`), which the hub minted for that box, so the hub
 * verifies a cookie the same way the box does and a junk cookie wakes nothing
 * (docs/implemented-plans/per-box-units.md, question 7, decided 2026-10-24).
 */

import type http from "node:http";
import { bearerMatchesHashes, hubMetaReadsEnabled, readHubMeta } from "../../core/hub-meta.js";
import { verifyAgentBearer } from "../../core/agent/token.js";
import { verifyMobileRequest } from "../../core/mobile/request-auth.js";
import { deriveMobileSessionKey, MOBILE_COOKIE_NAME, verifyMobileSessionWithKey } from "../../core/mobile/session.js";
import { resolveScanRequestAuth } from "../../core/scan/tokens.js";
import { parseCookieHeaderAll } from "../../lib/cookies.js";
import { appOrigin } from "../../core/browser/app-url.js";
import { boxPassVerifyKey, passKeyFromHubSecret, passValueValid, stripForeignBrowserPasses, verifyBrowserPassWithKey } from "../../core/browser/pass.js";

/** Headers in the shape both Fastify and raw Node give. */
export type GateHeaders = http.IncomingHttpHeaders;

function cookieHeader(headers: GateHeaders): string | undefined {
  return typeof headers.cookie === "string" ? headers.cookie : undefined;
}

/**
 * Does the request carry a credential of the box's mobile devices? On a unit
 * host a bearer is verified by hash and a `bbx_mobile` cookie by the key
 * derived from the box's hub secret (module doc). Every cookie value is tried,
 * as the box does: a sibling box's script can plant one beside the real one.
 * For the proxy gate only.
 */
export async function mobileAuthed(box: { boxRoot: string; hubSecret: string }, headers: GateHeaders): Promise<boolean> {
  if (!hubMetaReadsEnabled()) return verifyMobileRequest(box.boxRoot, headers);
  if (await mobileBearerAuthed(box.boxRoot, headers)) return true;
  if (box.hubSecret.length === 0) return false;
  const key = deriveMobileSessionKey(box.hubSecret);
  return (parseCookieHeaderAll(cookieHeader(headers))[MOBILE_COOKIE_NAME] ?? []).some((value) => verifyMobileSessionWithKey(key, value) !== null);
}

/**
 * The same question for a hub-owned answer (the `/api/boxes` listing): only a
 * credential the hub itself verified counts, so a made-up cookie cannot list
 * every box's slug on a unit host (cross-model review, codex gpt-6-sol,
 * 2026-10-24). A cookie-only mobile client gets its listing from the box.
 */
export async function mobileBearerAuthed(boxRoot: string, headers: GateHeaders): Promise<boolean> {
  if (!hubMetaReadsEnabled()) return verifyMobileRequest(boxRoot, headers);
  const meta = readHubMeta(boxRoot);
  return meta !== undefined && bearerMatchesHashes(headers.authorization, meta.tokenHashes.mobile);
}

/** Does the request carry one of the box's scan-upload tokens? The caller has checked the path. */
export async function scanAuthed(boxRoot: string, headers: GateHeaders): Promise<boolean> {
  if (!hubMetaReadsEnabled()) return (await resolveScanRequestAuth(boxRoot, headers)) !== null;
  const meta = readHubMeta(boxRoot);
  return meta !== undefined && bearerMatchesHashes(headers.authorization, meta.tokenHashes.scan);
}

/** Is this the box's own agent token? */
export function agentAuthed(boxRoot: string, authorization: string | undefined): boolean {
  if (!hubMetaReadsEnabled()) return verifyAgentBearer(boxRoot, authorization);
  const agent = readHubMeta(boxRoot)?.tokenHashes.agent;
  return agent !== undefined && agent !== null && bearerMatchesHashes(authorization, [agent]);
}

/** The pass key the hub checks this box's box-browser passes with; null when the box has none. */
function boxPassKey(box: { boxRoot: string; hubSecret: string }): string | null {
  return hubMetaReadsEnabled() ? passKeyFromHubSecret(box.hubSecret) : boxPassVerifyKey(box.boxRoot);
}

/**
 * Does the request carry this box's own browser pass, from the box's own pages
 * or a typed navigation (`core/browser/pass.ts`)? On a unit host the key is
 * derived from the box's hub secret, as the mobile cookie's is.
 */
export function browserPassAuthed(box: { boxRoot: string; hubSecret: string }, headers: GateHeaders): boolean {
  return verifyBrowserPassWithKey(boxPassKey(box), { appOrigin: appOrigin(process.env), headers, now: Date.now() });
}

/**
 * Forward only the target box's own pass. A pass at path `/` rides every box
 * path on the origin; a sibling box must never receive one it could replay.
 * With no target box, every pass is removed. Mutates `headers.cookie`.
 */
export function stripForeignPasses(headers: GateHeaders, box: { boxRoot: string; hubSecret: string } | undefined): void {
  const key = box === undefined ? null : boxPassKey(box);
  const now = Date.now();
  const kept = stripForeignBrowserPasses(cookieHeader(headers), (value) => passValueValid(key, { value, now }));
  if (kept === undefined) delete headers.cookie;
  else headers.cookie = kept;
}

/** The box a pass on a request to `slug` must belong to: undefined for no known box. */
export type PassBoxLookup = (slug: string | null) => { boxRoot: string; hubSecret: string } | undefined;

export function passBoxLookup(boxRootBySlug: ReadonlyMap<string, string>, secretFor: (slug: string | null) => string): PassBoxLookup {
  return (slug) => {
    const boxRoot = slug === null ? undefined : boxRootBySlug.get(slug);
    return boxRoot === undefined ? undefined : { boxRoot, hubSecret: secretFor(slug) };
  };
}

/**
 * Check a proxied request's browser pass for its target box, then forward only
 * that box's own pass: true when the pass admits the request.
 */
export function takeBrowserPass(headers: GateHeaders, box: { boxRoot: string; hubSecret: string } | undefined): boolean {
  const ok = box !== undefined && browserPassAuthed(box, headers);
  stripForeignPasses(headers, box);
  return ok;
}
