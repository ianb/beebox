/**
 * `resolveSecret` — the one way a value leaves the store
 * (`docs/implemented-plans/secret-custody.md`, Track 2).
 *
 * Grant-check → log → return. The grant lives under the box's SLUG (Decision
 * 2), so worktree clones of a box inherit its grants and a renamed box shows as
 * ungranted, which `bbx secrets status` then names.
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
 * secret it was never granted is exactly what an access log is for. What the
 * log records and what the STORE records are two different questions, which is
 * why `observe: false` exists — see the option's comment below.
 *
 * A caller that only asks "is this configured?" and never needs the value uses
 * `secretIsResolvable` instead: same checks, no value, no log line. That
 * question once ran on every scheduler tick for every box and made up ~99% of
 * the log.
 */

import { boxSlug } from "../../lib/box-slug.js";
import { invariant } from "../../shared/invariant.js";
import { err, ok, type Result } from "../../shared/result.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { appendSecretAccessEvent, stampSecretUse } from "./access-log.js";
import {
  DanglingSecretGrantError,
  EmptySecretSlotError,
  RealSecretStoreInTestError,
  SecretAgentAccessNotGrantedError,
  SecretNotGrantedError,
  SecretStoreUnreadableError,
  UnknownSecretError,
  type SecretRefusal,
} from "./errors.js";
import { loadSecretStore, secretsFilePath, type SecretAccessLevel, type SecretStoreData } from "./store.js";

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

/**
 * What a per-key reader (`core/mistral-key.ts` and its siblings) is told about
 * the read it is doing. One field today, stated at every call site rather than
 * defaulted, so "am I about to spend this key or just look at it?" is answered
 * where the answer is known — see {@link ResolveSecretOptions.observe}.
 */
export interface SecretRead {
  observe: boolean;
}

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
  /**
   * Does this resolve count as USE? Omit (or `true`) for real work — the
   * ordinary case. `false` is for a read that needs the value but does not
   * spend it, such as picking a route before the real call resolves again. A
   * check that only asks "is this key configured?" uses `secretIsResolvable`
   * and never reaches the log.
   *
   * The split is deliberate and lands in two different places:
   *
   * - The **access log** records it either way. The log is attribution — who
   *   read what, when — and a probe genuinely read the value, so hiding it
   *   would put a hole in the one record that answers "what touched this key".
   * - The **store metadata** (`lastUsed`, `purposes`) does NOT move. Those two
   *   fields answer "is this grant still earning its keep", and a dashboard
   *   polling health every minute would otherwise pin `lastUsed` to now forever
   *   and make a dead key look busy.
   */
  observe?: boolean;
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

  const loaded = await readStore(name);
  if (!loaded.ok) return refuse(loaded.error);

  const refusal = accessRefusal({ store: loaded.value, slug, name, access });
  if (refusal !== null) return refuse(refusal);
  const entry = loaded.value.secrets[name];
  invariant(entry?.value !== undefined, `accessRefusal passed "${name}" without a value`);

  await appendSecretAccessEvent({ ts, box: slug, secret: name, purpose, event: "resolve" });
  if (opts.observe !== false) await stampSecretUse({ slug, name, nowIso: ts, purpose });
  return ok({ value: entry.value, suspect: entry.verified?.status === "failed" });
}

/**
 * Would {@link resolveSecret} succeed for this box? The existence check for a
 * configuration question ("is Google set up here?"): it reads the store and
 * applies the same grant, access and empty-slot checks, but returns no value
 * and writes nothing to the access log or the store. A caller that goes on to
 * use the credential resolves it then, and that resolve is logged.
 */
export async function secretIsResolvable(opts: Omit<ResolveSecretOptions, "purpose" | "observe">): Promise<boolean> {
  const loaded = await readStore(opts.name);
  if (!loaded.ok) return false;
  const slug = opts.slug ?? (await boxSlug(opts.boxRoot));
  return accessRefusal({ store: loaded.value, slug, name: opts.name, access: opts.access }) === null;
}

/**
 * The store, or the store-unreadable refusal. That includes a store whose path
 * is refused (`RealSecretStoreInTestError`: a test process whose HOME is the
 * real home, such as a program a test started), because neither caller may throw.
 */
async function readStore(name: string): Promise<Result<SecretStoreData, SecretStoreUnreadableError>> {
  let storePath: string;
  try {
    storePath = secretsFilePath();
  } catch (e) {
    if (!(e instanceof RealSecretStoreInTestError)) throw e;
    return err(new SecretStoreUnreadableError({
      secretName: name,
      storePath: e.storePath,
      detail: "this is a test process and HOME is the real home directory; set BBX_SECRETS_FILE",
    }));
  }
  const loaded = await loadSecretStore();
  if (!loaded.ok) return err(new SecretStoreUnreadableError({ secretName: name, storePath, detail: loaded.error }));
  return ok(loaded.value);
}

/** Why this box may not have this secret's value, or null when it may. */
function accessRefusal(opts: {
  store: SecretStoreData;
  slug: string;
  name: string;
  access: SecretAccessLevel;
}): SecretRefusal | null {
  const { store, slug, name, access } = opts;
  const entry = store.secrets[name];
  const granted = store.grants[slug]?.[name];

  if (granted === undefined) {
    return entry === undefined
      ? new UnknownSecretError(name)
      : new SecretNotGrantedError({ secretName: name, boxSlug: slug });
  }
  if (entry === undefined) {
    return new DanglingSecretGrantError({ secretName: name, boxSlug: slug });
  }
  if (access === "agent" && granted === "server") {
    return new SecretAgentAccessNotGrantedError({ secretName: name, boxSlug: slug });
  }
  if (entry.value === undefined || entry.value === "") {
    return new EmptySecretSlotError(name);
  }
  return null;
}
