/**
 * `resolveSecret` — the one way a value leaves the store
 * (`docs/plans/secret-custody.md`, Track 2).
 *
 * Grant-check → log → return. The grant lives under the box's SLUG (Decision
 * 2), so worktree clones of a box inherit its grants and a renamed box shows as
 * ungranted, which `cb secrets status` then names.
 *
 * `access` is asserted by the CALLER, and it is the whole agent-vs-server line:
 * connector code running inside a server process passes `"server"`; anything
 * resolving on behalf of box/agent-authored code passes `"agent"`, which only a
 * grant explicitly raised to `agent` satisfies. A `server` grant never
 * discloses to agent-context code; an `agent` grant includes server access.
 * Nothing enforces the assertion below the call — this is a legibility and
 * blast-radius boundary, not a wall (the plan says so at length).
 *
 * Every outcome is logged, refusals included: a box repeatedly asking for a
 * secret it was never granted is exactly what an access log is for.
 */

import { boxSlug } from "../../lib/box-slug.js";
import { invariant } from "../../lib/invariant.js";
import { err, ok, type Result } from "../../lib/result.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { appendSecretAccessEvent, stampSecretUse } from "./access-log.js";
import {
  DanglingSecretGrantError,
  EmptySecretSlotError,
  SecretAgentAccessNotGrantedError,
  SecretNotGrantedError,
  SecretStoreUnreadableError,
  UnknownSecretError,
  type SecretRefusal,
} from "./errors.js";
import { loadSecretStore, secretsFilePath, type SecretAccessLevel } from "./store.js";

/**
 * What a `purpose` may look like: a short lowercase label, `transcription`,
 * `google-oauth`, `forecast-trick`.
 *
 * It is written VERBATIM into the access log and comes, on the loopback route,
 * from agent-authored code — so it is constrained to a label rather than
 * accepted as free text. An unbounded string there is a log-injection and
 * log-bloat surface (newlines, JSON, a whole prompt), and the log is the record
 * a boxholder reads to answer "what used this key". The loopback route rejects a
 * violation with 400; in-process callers are our own code, so the resolver
 * treats one as a broken invariant.
 */
export const SECRET_PURPOSE_PATTERN = /^[\da-z][\da-z-]{0,39}$/;

/** A resolved value, plus whether the entry's last probe failed auth. */
export interface ResolvedSecret {
  value: string;
  /** The last probe (or real use) failed — "this key may be expired". */
  suspect: boolean;
}

export interface ResolveSecretOptions {
  /** The asking box's operational root (`<package>/content`). */
  boxRoot: string;
  name: string;
  /** Short caller-supplied string for the log, e.g. "transcription". */
  purpose: string;
  /** What the caller is: server-process code, or box/agent-authored code. */
  access: SecretAccessLevel;
  /** The authoritative slug where one is threaded (`ctx.boxSlug`, `BoxSpec`);
   *  omitted callers get it derived from disk. */
  slug?: string;
}

/**
 * Resolve one secret for one box. Returns a typed refusal rather than throwing:
 * every caller branches on *why* (a missing grant degrades a connector to "not
 * configured" with a relayable explanation; an unreadable store is a machine
 * problem the boxholder must fix).
 */
export async function resolveSecret(opts: ResolveSecretOptions): Promise<Result<ResolvedSecret, SecretRefusal>> {
  const { boxRoot, name, purpose, access } = opts;
  invariant(
    SECRET_PURPOSE_PATTERN.test(purpose),
    `Secret resolve purpose ${JSON.stringify(purpose)} is not a short label ` +
      "(lowercase letters, digits and dashes, 40 characters max) — it goes verbatim into the access log",
  );
  const slug = opts.slug ?? (await boxSlug(boxRoot));
  const ts = getBoxTimeISO(boxRoot);

  const refuse = async (refusal: SecretRefusal): Promise<Result<ResolvedSecret, SecretRefusal>> => {
    await appendSecretAccessEvent({ ts, box: slug, secret: name, purpose, event: "refuse", refusal: refusal.kind });
    return err(refusal);
  };

  const loaded = await loadSecretStore();
  if (!loaded.ok) {
    return refuse(
      new SecretStoreUnreadableError({ secretName: name, storePath: secretsFilePath(), detail: loaded.error }),
    );
  }

  const entry = loaded.value.secrets[name];
  const granted = loaded.value.grants[slug]?.[name];

  if (granted === undefined) {
    return refuse(
      entry === undefined ? new UnknownSecretError(name) : new SecretNotGrantedError({ secretName: name, boxSlug: slug }),
    );
  }
  if (entry === undefined) {
    return refuse(new DanglingSecretGrantError({ secretName: name, boxSlug: slug }));
  }
  if (access === "agent" && granted === "server") {
    return refuse(new SecretAgentAccessNotGrantedError({ secretName: name, boxSlug: slug }));
  }
  if (entry.value === undefined || entry.value === "") {
    return refuse(new EmptySecretSlotError(name));
  }

  await appendSecretAccessEvent({ ts, box: slug, secret: name, purpose, event: "resolve" });
  await stampSecretUse({ slug, name, nowIso: ts, purpose });
  return ok({ value: entry.value, suspect: entry.verified?.status === "failed" });
}
