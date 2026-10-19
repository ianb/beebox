// # Verifying a stored secret: the server-owned probe registry
//
// `src/core/secrets/probe-registry.ts` answers "does this credential actually
// work?" by making one cheap, harmless, authenticated call and recording the
// verdict on the entry (`docs/implemented-plans/secret-custody.md`, "Guided entry +
// validation").
//
// Two properties matter more than the happy path:
//
// - **Only the server names probe targets.** An agent-supplied probe URL would
//   send the freshly-saved secret wherever the agent pointed it. Names with no
//   registry entry stay `unchecked` forever — never "probe whatever you like".
// - **A bad day is not a bad key.** Only a provider's *auth rejection* records
//   `failed` (which is what later makes a resolve `suspect`); a 500, a timeout, or
//   DNS failure records `unchecked` with a reason.
//
// Every value below is an obvious placeholder, and `fetch` is injected — no test
// here reaches a real provider.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxSlug } from "../../../src/lib/box-slug.js";
import {
  grantSecret,
  listSecrets,
  setSecret,
} from "../../../src/core/secrets/lifecycle.js";
import {
  describeSecretProbe,
  isAuthRejection,
  markSecretVerificationFailed,
  probeSecret,
} from "../../../src/core/secrets/probe-registry.js";
import { resolveSecret } from "../../../src/core/secrets/resolve.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { FetchLike } from "../../../src/core/secrets/probe-registry.js";
import { invariant } from "../../../src/shared/invariant.js";

interface RecordedCall {
  url: string;
  headers: Headers;
}

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

/** A `fetch` that records what it was asked for and answers with one status. */
function recordingFetch(status: number, calls: RecordedCall[]): FetchLike {
  return async (url, init) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response("{}", { status });
  };
}

/** The stored verdict for a name — what a later resolve and the admin UI read. */
async function storedVerified(name: string) {
  const listing = (await listSecrets()).find((entry) => entry.name === name);
  return listing?.verified;
}

// ## A working key: `ok`, recorded on the entry
//
// The Mistral probe lists models — a read-only call that creates nothing and
// charges nothing. The key travels in the `Authorization` header, never in the URL.
void test("The Mistral probe lists models — a read-only call that creates nothing and ch...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await useTempStore();
  const calls: RecordedCall[] = [];
  await setSecret({ name: "mistral", value: "placeholder-mistral-key" });
  const verified = await probeSecret({ name: "mistral", deps: { fetch: recordingFetch(200, calls) } });

  t.check(verified, { status: "ok", at: isoDate() });
  t.check(calls[0]?.url, "https://api.mistral.ai/v1/models");
  t.check(calls[0]?.headers.get("Authorization"), "Bearer placeholder-mistral-key");
  t.check(await storedVerified("mistral"), { status: "ok", at: isoDate() });

  // ## A rejected key: `failed`, and the reason never quotes the value

  const rejected = await probeSecret({ name: "mistral", deps: { fetch: recordingFetch(401, []) } });
  t.check(rejected, { status: "failed", reason: "the provider rejected this credential (HTTP 401)", at: isoDate() });

  // ## A provider outage is inconclusive, not a bad key
  //
  // A 500 must never flag a working credential as expired — the boxholder would
  // rotate a perfectly good key.

  const blip = await probeSecret({ name: "mistral", deps: { fetch: recordingFetch(500, []) } });
  t.check(blip, { status: "unchecked", reason: "the check was inconclusive (HTTP 500)", at: isoDate() });
  t.check([isAuthRejection(401), isAuthRejection(500), isAuthRejection(429)], [true, false, false]);

  // ## A name with no registry entry stays unchecked, and nothing is written
  //
  // An ad-hoc slot an agent declared has no server-owned probe, and never gains one.

  await setSecret({ name: "weatherapi", value: "placeholder-weather-key" });
  const adhoc = await probeSecret({ name: "weatherapi", deps: { fetch: recordingFetch(200, []) } });
  t.check(adhoc, { status: "unchecked", reason: "no verification is available for this credential", at: isoDate() });
  t.check(await storedVerified("weatherapi"), undefined);
  t.check(describeSecretProbe({ name: "weatherapi" }), null);
  t.check(describeSecretProbe({ name: "mistral" }), "lists Mistral models");

  // ## A value that is not the shape the credential needs is `failed`
  //
  // A multi-field credential (Deepgram's key and project id) is stored as JSON its
  // consumer parses. When the stored value does not parse, the probe cannot be run,
  // and the boxholder needs to know that, not a silent `unchecked`.

  await setSecret({ name: "deepgram", value: "not-json-at-all" });
  const malformed = await probeSecret({ name: "deepgram", deps: { fetch: recordingFetch(200, []) } });
  t.check(malformed, { status: "failed", reason: "the stored value is not in the shape this credential needs", at: isoDate() });

  // ## A probe that outlives its value never stamps the new one
  //
  // A slow probe against the old key must not land on the rotated one: it would
  // either hide a bad rotation behind `ok` or mark a fresh key as expired. The write
  // is a compare-and-set on the entry's `updated` stamp.

  let release: () => void = () => {};
  const slowFetch = async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return new Response("{}", { status: 401 });
  };
  const slow = probeSecret({ name: "mistral", deps: { fetch: slowFetch } });
  await setSecret({ name: "mistral", value: "placeholder-mistral-key-2" });
  release();
  t.check(await slow, { status: "failed", reason: "the provider rejected this credential (HTTP 401)", at: isoDate() });
  t.check(await storedVerified("mistral"), undefined);

  // ## Suspect round-trip: a real 401 makes every later resolve say so
  //
  // `markSecretVerificationFailed` is what a consumer calls when a real call is
  // rejected for auth — better evidence than any probe, since it is the call the box
  // actually needed. `resolveSecret` surfaces it as `suspect`, which the admin page
  // renders as "may be expired".

  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  await grantSecret({ slug, name: "weatherapi", access: "agent" });

  const before = await resolveSecret({ boxRoot: box.root, name: "weatherapi", purpose: "forecast", access: "agent" });
  invariant(before.ok, "the granted secret resolves");
  t.check(before.value, { value: "placeholder-weather-key", suspect: false });

  await markSecretVerificationFailed("weatherapi", "a forecast request was rejected with HTTP 401");
  const after = await resolveSecret({ boxRoot: box.root, name: "weatherapi", purpose: "forecast", access: "agent" });
  invariant(after.ok, "the suspect secret still resolves");
  t.check(after.value, { value: "placeholder-weather-key", suspect: true });
  t.check(await storedVerified("weatherapi"), { status: "failed", reason: "a forecast request was rejected with HTTP 401", at: isoDate() });

  // Storing a new value clears the old verdict — a rotated key has not been checked
  // yet, and carrying `failed` forward would leave a fresh key marked expired.

  await setSecret({ name: "weatherapi", value: "placeholder-weather-key-2" });
  t.check(await storedVerified("weatherapi"), undefined);
});
