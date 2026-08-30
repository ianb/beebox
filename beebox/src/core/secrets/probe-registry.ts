/**
 * Hard validation for stored secrets: a cheap, harmless, authenticated call
 * that answers "does this credential actually work?"
 * (`docs/plans/secret-custody.md`, "Guided entry + validation").
 *
 * **The registry is SERVER-OWNED, and that is the security property, not a
 * convenience.** A probe sends the freshly-saved secret to the URL it names, so
 * an agent-supplied probe target would be a one-request exfiltration path
 * dressed as a feature. Nothing outside this file can name a URL: an agent may
 * supply a format *hint* (`format-registry.ts`), never a probe. Names with no
 * entry here stay `unchecked` forever, which is the honest answer.
 *
 * Every endpoint below is a read-only listing or identity call — no resource is
 * created, nothing is charged, no state changes at the provider:
 *
 * | Name | Call |
 * |---|---|
 * | `mistral` | `GET https://api.mistral.ai/v1/models` |
 * | `openai`, `openai-thinking` | `GET https://api.openai.com/v1/models` |
 * | `gemini` | `GET https://generativelanguage.googleapis.com/v1beta/models` |
 * | `deepgram` | `GET https://api.deepgram.com/v1/projects` |
 * | `telegram-bot/<box>` | `GET https://api.telegram.org/bot<token>/getMe` |
 *
 * `publish/<box>` deliberately has NO probe: verifying an R2 token means a
 * bucket operation, which is neither free of side effects nor cheap, so the
 * publish credential stays `unchecked` rather than getting a probe that
 * violates the harmlessness rule.
 *
 * **Three outcomes, and the middle one matters.** `ok` and `failed` are what
 * they sound like; anything that does not distinguish a bad credential from a
 * bad day — a 500, a timeout, DNS failure — records `unchecked` with a reason.
 * Only `failed` makes a later resolve `suspect`, so a provider outage must
 * never flag a perfectly good key as expired.
 *
 * A reason string is written into the store and shown in the admin UI, so it is
 * assembled from the STATUS CODE and fixed prose only — never from the secret,
 * and never from a response body that could echo it back.
 */

import { z } from "zod";
import { errnoCode, toError } from "../../lib/error-guards.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { parseJsonSecret } from "./json-secret.js";
import { lookupByName } from "./name-match.js";
import { loadSecretStore, mutateSecretStore, type SecretEntry } from "./store.js";

/** The subset of `fetch` a probe calls — injectable so tests never leave the machine. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** How long a probe waits before recording `unchecked` and moving on. */
const PROBE_TIMEOUT_MS = 10_000;

/** The statuses that mean "the provider rejected this credential", by default. */
const DEFAULT_AUTH_FAILURE_STATUSES = [401, 403];

/**
 * Does this HTTP status mean the provider rejected the credential?
 *
 * For CONSUMERS to use on their own error paths — a 401 from a real
 * transcription is better evidence than any probe. Deliberately narrow: a 429
 * or a 500 is not an auth problem, and treating it as one would flag a working
 * key as suspect during a rate-limit spike.
 */
export function isAuthRejection(status: number): boolean {
  return DEFAULT_AUTH_FAILURE_STATUSES.includes(status);
}

/** What a probe entry turns a stored value into. */
interface ProbeRequest {
  url: string;
  headers: Record<string, string>;
}

interface ProbeEntry {
  /** Shown in the admin UI so the boxholder knows what the check did. */
  describe: string;
  /** `null` when the stored value is not in the shape this provider needs. */
  request: (value: string) => ProbeRequest | null;
  /** Overrides {@link DEFAULT_AUTH_FAILURE_STATUSES} where a provider differs. */
  authFailureStatuses?: number[];
}

const deepgramSecretSchema = z.object({ apiKey: z.string().min(1) });
const telegramSecretSchema = z.object({ botToken: z.string().min(1) });

function bearer(url: string): (value: string) => ProbeRequest {
  return (value) => ({ url, headers: { Authorization: `Bearer ${value}` } });
}

/** Keyed by exact store name, or by a `family/` prefix for per-box instances. */
const probes: Record<string, ProbeEntry> = {
  mistral: { describe: "lists Mistral models", request: bearer("https://api.mistral.ai/v1/models") },
  openai: { describe: "lists OpenAI models", request: bearer("https://api.openai.com/v1/models") },
  "openai-thinking": { describe: "lists OpenAI models", request: bearer("https://api.openai.com/v1/models") },
  gemini: {
    describe: "lists Gemini models",
    request: (value) => ({
      // The key goes in a header, not the `?key=` query parameter the Google
      // docs lead with: a URL carrying a credential ends up in proxy and error
      // logs, and a probe must not be the thing that leaks the value.
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      headers: { "x-goog-api-key": value },
    }),
    // Google answers a bad API key with 400 INVALID_ARGUMENT, not 401.
    authFailureStatuses: [400, 401, 403],
  },
  deepgram: {
    describe: "lists Deepgram projects",
    request: (value) => {
      const creds = parseJsonSecret({ name: "deepgram", value, schema: deepgramSecretSchema });
      if (creds === null) return null;
      return { url: "https://api.deepgram.com/v1/projects", headers: { Authorization: `Token ${creds.apiKey}` } };
    },
  },
  "telegram-bot/": {
    describe: "calls the Telegram bot's getMe",
    request: (value) => {
      const creds = parseJsonSecret({ name: "telegram-bot", value, schema: telegramSecretSchema });
      if (creds === null) return null;
      // Telegram has no header auth — the token IS the path segment. Nothing
      // else about this call is unusual, and getMe changes nothing.
      return { url: `https://api.telegram.org/bot${creds.botToken}/getMe`, headers: {} };
    },
  },
};

export type SecretVerified = NonNullable<SecretEntry["verified"]>;

/** In-process probes by `<name>@<updated>`, so one write means one request. */
const inFlight = new Map<string, Promise<SecretVerified>>();

/** The provenance fields a per-box family probe requires. See {@link probeEntryFor}. */
export interface SecretProvenance {
  owningBox?: string | undefined;
  shareable?: boolean | undefined;
}

/**
 * The probe for one entry, or `null`.
 *
 * A `family/` prefix entry (`telegram-bot/`) additionally requires that the
 * entry was created by the connector flow that owns that family — it carries
 * `owningBox` + `shareable: false`. Without that check, an agent could DECLARE a
 * slot named `telegram-bot/anything`, and whatever value the boxholder then
 * pasted in would be sent to api.telegram.org by a probe the agent effectively
 * chose. Exact names are safe by construction: an agent cannot make `mistral`
 * mean something else.
 */
function probeEntryFor(opts: { name: string } & SecretProvenance): { key: string; entry: ProbeEntry } | null {
  const found = lookupByName(probes, opts.name);
  if (found === null) return null;
  if (!found.key.endsWith("/")) return found;
  if (opts.shareable === false && opts.owningBox !== undefined) return found;
  return null;
}

/** What the probe registry offers for an entry, for the admin UI to explain. */
export function describeSecretProbe(opts: { name: string } & SecretProvenance): string | null {
  return probeEntryFor(opts)?.entry.describe ?? null;
}

/**
 * The kind of failure, with no message text. `AbortError` for a timeout,
 * `TypeError` for a connection failure, and the `code` where one exists.
 */
function errorClass(e: unknown): string {
  const error = toError(e);
  const code = errnoCode(e);
  return code === undefined ? error.name : `${error.name}/${code}`;
}

function isAuthFailure(entry: ProbeEntry, status: number): boolean {
  const statuses = entry.authFailureStatuses ?? DEFAULT_AUTH_FAILURE_STATUSES;
  return statuses.includes(status);
}

async function runProbe(opts: { entry: ProbeEntry; value: string; at: string; doFetch: FetchLike }): Promise<SecretVerified> {
  const request = opts.entry.request(opts.value);
  if (request === null) {
    return { status: "failed", at: opts.at, reason: "the stored value is not in the shape this credential needs" };
  }
  let response: Response;
  try {
    response = await opts.doFetch(request.url, {
      method: "GET",
      headers: request.headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (e) {
    // A network failure says nothing about the credential — recording `failed`
    // here would flag a good key as suspect every time the provider blipped.
    //
    // Only the error's CLASS is recorded, never its message: fetch and proxy
    // errors routinely quote the request URL, and Telegram's probe URL contains
    // the bot token, so a stored-and-displayed message could publish the secret
    // into the admin page. A class name is enough to tell a timeout from DNS.
    return { status: "unchecked", at: opts.at, reason: `could not reach the provider (${errorClass(e)})` };
  }
  if (response.ok) return { status: "ok", at: opts.at };
  if (isAuthFailure(opts.entry, response.status)) {
    return { status: "failed", at: opts.at, reason: `the provider rejected this credential (HTTP ${response.status})` };
  }
  return { status: "unchecked", at: opts.at, reason: `the check was inconclusive (HTTP ${response.status})` };
}

/**
 * Write a verification result onto the entry — but only if the entry is still
 * the one that was probed.
 *
 * A probe can outlive the value it checked: a slow request against the old key
 * finishing after a rotation would stamp the old verdict onto the new value,
 * either hiding a bad rotation behind `ok` or flagging a fresh key as expired.
 * `updated` is the store's own version marker, so comparing it under the lock
 * makes the write a compare-and-set.
 */
async function storeVerified(opts: { name: string; probedUpdated: string; verified: SecretVerified }): Promise<void> {
  await mutateSecretStore({ purpose: "verify" }, (store) => {
    const entry = store.secrets[opts.name];
    if (entry === undefined) return;
    if (entry.updated !== opts.probedUpdated) return;
    entry.verified = opts.verified;
  });
}

/**
 * Probe one stored secret and record the result on its entry.
 *
 * The value is read here and used for exactly one outbound request; it is never
 * returned, logged, or embedded in the reason. A name with no registry entry,
 * or an entry with no value yet, records `unchecked` with the reason — the
 * admin UI needs to distinguish "we checked and it is fine" from "nobody has
 * ever checked this", and a silent no-op would collapse the two.
 */
export async function probeSecret(opts: { name: string; deps?: { fetch?: FetchLike | undefined } }): Promise<SecretVerified> {
  const at = getBoxTimeISO();
  // `BBX_SECRET_PROBES=off` suppresses the REAL network path only — the test
  // harness sets it for every test process so a doctest storing a placeholder
  // key can never send it to a live provider, while a caller that injected its
  // own `fetch` is by definition not leaving the machine and still runs.
  const doFetch = opts.deps?.fetch;
  if (doFetch === undefined && process.env.BBX_SECRET_PROBES === "off") {
    return { status: "unchecked", at, reason: "verification is turned off on this machine" };
  }
  const loaded = await loadSecretStore();
  if (!loaded.ok) return { status: "unchecked", at, reason: `the secret store could not be read (${loaded.error})` };
  const entry = loaded.value.secrets[opts.name];
  const found = probeEntryFor({ name: opts.name, owningBox: entry?.owningBox, shareable: entry?.shareable });
  if (found === null) {
    return { status: "unchecked", at, reason: "no verification is available for this credential" };
  }
  const value = entry?.value;
  if (entry === undefined || value === undefined || value === "") {
    return { status: "unchecked", at, reason: "this slot has no value yet" };
  }
  // Keyed by the entry's `updated` stamp, not the name alone: a write fires a
  // background probe AND the admin surface awaits one for immediate feedback,
  // and those two must be one request, while a rotation an instant later must
  // still get its own (it is a different value).
  const probedUpdated = entry.updated;
  const key = `${opts.name}@${probedUpdated}`;
  const running = inFlight.get(key);
  if (running !== undefined) return running;
  const probe = runProbe({ entry: found.entry, value, at, doFetch: doFetch ?? fetch })
    .then(async (verified) => {
      await storeVerified({ name: opts.name, probedUpdated, verified });
      return verified;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, probe);
  return probe;
}

/**
 * Record that a REAL use of a secret was rejected for authentication — the
 * "last use failed auth" suspect flag. `resolveSecret` already turns a `failed`
 * verification into `suspect: true` on every later resolve, so this is what
 * closes the loop between a 401 in a connector and the boxholder seeing "this
 * key may be expired" on the admin page.
 *
 * Best-effort by declaration, like the access log: this runs on an error path
 * that is already degrading, and it must never replace the caller's real error
 * with a store-write failure.
 */
export async function markSecretVerificationFailed(name: string, reason: string): Promise<void> {
  try {
    await mutateSecretStore({ purpose: "verify" }, (store) => {
      const entry = store.secrets[name];
      // No version check here, unlike a probe: the caller just used whatever
      // value the store holds right now, so "the current value was rejected" is
      // exactly the claim being recorded.
      if (entry === undefined) return;
      entry.verified = { status: "failed", at: getBoxTimeISO(), reason };
    });
  } catch (e) {
    console.warn(`[secrets] could not flag "${name}" as failing authentication:`, e);
  }
}

/**
 * Fire-and-forget the probe after a write, per the plan's "after save, the
 * server calls a cheap harmless endpoint". The caller must not wait: saving a
 * key succeeded whether or not the provider is reachable this second, and the
 * result is picked up from the entry on the next read.
 *
 * {@link probeSecret} owns the `BBX_SECRET_PROBES=off` gate, so this needs no
 * check of its own.
 */
export function probeSecretInBackground(name: string): void {
  void probeSecret({ name }).catch((e: unknown) => {
    console.warn(`[secrets] the verification probe for "${name}" could not run:`, e);
  });
}
