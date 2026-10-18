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
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
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
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
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
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L75
  const dir = await useTempStore();
  const calls: RecordedCall[] = [];
  await setSecret({ name: "mistral", value: "placeholder-mistral-key" });
  const verified = await probeSecret({ name: "mistral", deps: { fetch: recordingFetch(200, calls) } });

  // doctest:L80
  print(`verdict: ${verified.status}`);
  print(`called: ${calls[0]?.url}`);
  print(`key travelled in the header: ${calls[0]?.headers.get("Authorization") === "Bearer placeholder-mistral-key"}`);
  await t.checkText(out.with(print(`recorded on the entry: ${(await storedVerified("mistral"))?.status}`)), `verdict: ok
called: https://api.mistral.ai/v1/models
key travelled in the header: true
recorded on the entry: ok`);

  // ## A rejected key: `failed`, and the reason never quotes the value

  // doctest:L94
  const rejected = await probeSecret({ name: "mistral", deps: { fetch: recordingFetch(401, []) } });
  print(`verdict: ${rejected.status}`);
  print(`reason: ${rejected.reason}`);
  await t.checkText(out.with(print(`reason leaks the value: ${JSON.stringify(rejected).includes("placeholder-mistral-key")}`)), `verdict: failed
reason: the provider rejected this credential (HTTP 401)
reason leaks the value: false`);

  // ## A provider outage is inconclusive, not a bad key
  //
  // A 500 must never flag a working credential as expired — the boxholder would
  // rotate a perfectly good key.

  // doctest:L110
  const blip = await probeSecret({ name: "mistral", deps: { fetch: recordingFetch(500, []) } });
  print(`verdict: ${blip.status}`);
  print(`reason: ${blip.reason}`);
  await t.checkText(out.with(print(`401 counts as auth, 500 and 429 do not: ${[isAuthRejection(401), isAuthRejection(500), isAuthRejection(429)].join(" ")}`)), `verdict: unchecked
reason: the check was inconclusive (HTTP 500)
401 counts as auth, 500 and 429 do not: true false false`);

  // ## A name with no registry entry stays unchecked, and nothing is written
  //
  // An ad-hoc slot an agent declared has no server-owned probe, and never gains one.

  // doctest:L125
  await setSecret({ name: "weatherapi", value: "placeholder-weather-key" });
  const adhoc = await probeSecret({ name: "weatherapi", deps: { fetch: recordingFetch(200, []) } });
  print(`verdict: ${adhoc.status}`);
  print(`reason: ${adhoc.reason}`);
  print(`entry left unverified: ${(await storedVerified("weatherapi")) === undefined}`);
  print(`no probe described: ${describeSecretProbe({ name: "weatherapi" })}`);
  await t.checkText(out.with(print(`mistral has one: ${describeSecretProbe({ name: "mistral" })}`)), `verdict: unchecked
reason: no verification is available for this credential
entry left unverified: true
no probe described: null
mistral has one: lists Mistral models`);

  // ## A value that is not the shape the credential needs is `failed`
  //
  // A multi-field credential (Deepgram's key and project id) is stored as JSON its
  // consumer parses. When the stored value does not parse, the probe cannot be run,
  // and the boxholder needs to know that, not a silent `unchecked`.

  // doctest:L147
  await setSecret({ name: "deepgram", value: "not-json-at-all" });
  const malformed = await probeSecret({ name: "deepgram", deps: { fetch: recordingFetch(200, []) } });
  await t.checkText(out.with(print(`verdict: ${malformed.status} — ${malformed.reason}`)), "verdict: failed — the stored value is not in the shape this credential needs");

  // ## A probe that outlives its value never stamps the new one
  //
  // A slow probe against the old key must not land on the rotated one: it would
  // either hide a bad rotation behind `ok` or mark a fresh key as expired. The write
  // is a compare-and-set on the entry's `updated` stamp.

  // doctest:L161
  let release: () => void = () => {};
  const slowFetch = async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return new Response("{}", { status: 401 });
  };
  const slow = probeSecret({ name: "mistral", deps: { fetch: slowFetch } });
  await setSecret({ name: "mistral", value: "placeholder-mistral-key-2" });
  release();
  print(`the stale probe still reports: ${(await slow).status}`);
  await t.checkText(out.with(print(`but the rotated entry is untouched: ${(await storedVerified("mistral")) === undefined}`)), `the stale probe still reports: failed
but the rotated entry is untouched: true`);

  // ## Suspect round-trip: a real 401 makes every later resolve say so
  //
  // `markSecretVerificationFailed` is what a consumer calls when a real call is
  // rejected for auth — better evidence than any probe, since it is the call the box
  // actually needed. `resolveSecret` surfaces it as `suspect`, which the admin page
  // renders as "may be expired".

  // doctest:L184
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  await grantSecret({ slug, name: "weatherapi", access: "agent" });

  // doctest:L188
  const before = await resolveSecret({ boxRoot: box.root, name: "weatherapi", purpose: "forecast", access: "agent" });
  invariant(before.ok, "the granted secret resolves");
  print(`before: suspect=${before.value.suspect}`);

  // doctest:L192
  await markSecretVerificationFailed("weatherapi", "a forecast request was rejected with HTTP 401");
  const after = await resolveSecret({ boxRoot: box.root, name: "weatherapi", purpose: "forecast", access: "agent" });
  invariant(after.ok, "the suspect secret still resolves");
  print(`after: suspect=${after.value.suspect}`);
  print(`the value still resolves: ${after.value.value === "placeholder-weather-key"}`);
  await t.checkText(out.with(print(`reason on the entry: ${(await storedVerified("weatherapi"))?.reason}`)), `before: suspect=false
after: suspect=true
the value still resolves: true
reason on the entry: a forecast request was rejected with HTTP 401`);

  // Storing a new value clears the old verdict — a rotated key has not been checked
  // yet, and carrying `failed` forward would leave a fresh key marked expired.

  // doctest:L209
  await setSecret({ name: "weatherapi", value: "placeholder-weather-key-2" });
  await t.checkText(out.with(print(`after rotation: ${(await storedVerified("weatherapi")) === undefined}`)), "after rotation: true");
});
