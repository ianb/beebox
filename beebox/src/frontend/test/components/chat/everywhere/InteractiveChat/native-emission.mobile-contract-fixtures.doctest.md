# Cross-platform mobile-contract golden fixtures

The JSON files under `test/mobile-contract/fixtures/` are the shared golden
vectors every mobile client is checked against — the web-side doctests here, the
iOS `SpeechKeywordsTests` XCTest suite, and (later) an Android JUnit suite all
load the **same files**. A contract change edits a fixture once and every
platform's suite fails for the cases the fixtures represent until it catches up.
The design and policy live in `docs/implemented-plans/mobile-parity-sync.md` and
`docs/mobile-contract.md`.

Each fixture is one well-formed JSON file: `{ "input": …, "expected": … }` plus
family-specific flags (`variant`, `debugOnly`, `expectGeneratedId`,
`ignoredByClient`). A malformed-payload case is **not** a broken file — the
malformed thing lives as the `input` value inside a valid file, and `expected`
records the documented lenient outcome.

Fixtures test the two wire directions differently (contract §2 of the plan):
canonical **encoders** are shape-exact, while **decoders** are asserted per the
documented compatibility policy — lenient exactly where the contract says so
(e.g. `nativeEmissionFromDetail`, contract §4.1). This doctest runs the families
that have real web-side code (`emission`, `receipt`, `speech-keywords`) through
that code, and structurally validates the families that are consumed only by the
native clients (`location`, `pairing-url`, `redeem`) against their documented
shapes. `push-token` and `apns-payload` run through the server's own body
schema and payload builder. One family lives elsewhere on the web side: `debug-log-submit` is POSTed
verbatim at the real route by `test/webapp/trpc/routers/debug-log.submit.doctest.md`, because
its server-side consumer is an HTTP endpoint rather than a parser.

```ts setup
import { composerBindingPublicationSchema } from "../../../../../../shared/chat-composer-binding.js";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { nativeEmissionFromDetail, parseNativeEmissionDetail } from "../../../../../src/components/chat/everywhere/InteractiveChat/native-emission.js";
import { nativeCommandResultFromDetail, nativeComposerCommandAcknowledgementFromDetail, nativeComposerCommandFromDetail } from "../../../../../src/components/chat/native-composer-command.js";
import { nativeLastAudioRequestFromDetail } from "../../../../../src/components/chat/native-last-audio-request.js";
import { nativeSpeechCommandFromDetail } from "../../../../../src/components/chat/everywhere/InteractiveChat/native-speech-command.js";
import { detectKeyword, appendSendKeywordTag } from "../../../../../src/lib/audio/speech-keywords.js";
import { PushTokenBody } from "../../../../../../webapp/routes/pairing.js";
import { buildApnsRequest } from "../../../../../../core/notification/apns-channel/payload.js";
import { parseTarget } from "../../../../../../core/notification/target.js";
import { LOUDNESS } from "../../../../../../core/notification/intent.js";
import { z } from "zod";

// Shared cross-platform golden fixtures (also loaded by
// test/core/notification/apns-channel/payload.doctest.md and
// test/webapp/trpc/routers/debug-log.submit.doctest.md); stays at the package root per
// rule 3 (multiple areas' tests are users), even though this doctest itself
// moved into the frontend's own test tree.
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../../../../test/mobile-contract/fixtures");

type Dict = Record<string, unknown>;
type Verdict = { ok: boolean; detail?: string };
// One fixture file: `input`/`expected` stay unknown until a validator narrows them.
interface Fixture {
  input: unknown;
  expected?: unknown;
  variant?: string;
  op?: string;
  status?: number;
  expectedReason?: string;
  expectedValid?: boolean;
  expectGeneratedId?: boolean;
  ignoredByClient?: string[];
}
function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
// Narrow a fixture value that must be an object; a non-object throws, which runFamily reports as a failure.
function dict(v: unknown): Dict {
  if (!isDict(v)) throw new Error(`expected an object, got ${JSON.stringify(v)}`);
  return v;
}
const fixtureSchema = z.object({
  input: z.unknown(),
  expected: z.unknown().optional(),
  variant: z.string().optional(),
  op: z.string().optional(),
  status: z.number().optional(),
  expectedReason: z.string().optional(),
  expectedValid: z.boolean().optional(),
  expectGeneratedId: z.boolean().optional(),
  ignoredByClient: z.array(z.string()).optional(),
});

function loadFamily(family: string): { file: string; fixture: Fixture }[] {
  const dir = join(FIXTURES_DIR, family);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, fixture: fixtureSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf-8"))) }));
}

// Order-insensitive structural equality (object keys sorted, array order kept).
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (isDict(v)) {
    const out: Dict = {};
    for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
    return out;
  }
  return v;
}
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

// Run one family's fixtures through a validator. Throws with per-case detail on
// any mismatch (a loud regression); otherwise returns the summary line.
function runFamily(family: string, validate: (fx: Fixture) => Verdict) {
  const entries = loadFamily(family);
  const failures = [];
  for (const { file, fixture } of entries) {
    let result: Verdict;
    try {
      result = validate(fixture);
    } catch (e) {
      result = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    if (!result.ok) failures.push(`${file}: ${result.detail ?? "failed"}`);
  }
  if (failures.length > 0) throw new Error(`${family} fixtures failed:\n${failures.join("\n")}`);
  return JSON.stringify({ family, cases: entries.length, pass: entries.length });
}
```

```ts setup
// ── emission: the web decoder, documented-lenient (contract §4.1) ──
function validateEmission(fx: Fixture): Verdict {
  const parsed = parseNativeEmissionDetail(fx.input);
  if (fx.expectedReason !== undefined) {
    if (parsed.ok) return { ok: false, detail: `expected rejection, got ${JSON.stringify(parsed.emission)}` };
    if (parsed.reason !== fx.expectedReason) {
      return { ok: false, detail: `expected reason ${JSON.stringify(fx.expectedReason)}, got ${JSON.stringify(parsed.reason)}` };
    }
  }
  const out = nativeEmissionFromDetail(fx.input);
  if (fx.expected === null) {
    return out === null ? { ok: true } : { ok: false, detail: `expected null, got ${JSON.stringify(out)}` };
  }
  if (out === null) return { ok: false, detail: "expected an emission, got null" };
  if (fx.expectGeneratedId) {
    if (typeof out.id !== "string" || out.id.length === 0) {
      return { ok: false, detail: `expected a generated id, got ${JSON.stringify(out.id)}` };
    }
    return deepEqual(out, { ...dict(fx.expected), id: out.id })
      ? { ok: true }
      : { ok: false, detail: `got ${JSON.stringify(out)}` };
  }
  return deepEqual(out, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(out)}` };
}

// ── composer-command: strict web→native add-selection command ──
function validateComposerCommand(fx: Fixture): Verdict {
  const out = nativeComposerCommandFromDetail(fx.input);
  return deepEqual(out, fx.expected)
    ? { ok: true }
    : { ok: false, detail: `got ${JSON.stringify(out)}` };
}

// ── composer-command-result: the native→web answer a V2 command produced ──
function validateCommandResult(fx: Fixture): Verdict {
  const out = nativeCommandResultFromDetail(fx.input);
  return deepEqual(out, fx.expected)
    ? { ok: true }
    : { ok: false, detail: `got ${JSON.stringify(out)}` };
}

// ── composer-command-ack: strict native→web mutation result ──
function validateComposerCommandAcknowledgement(fx: Fixture): Verdict {
  const out = nativeComposerCommandAcknowledgementFromDetail(fx.input);
  return deepEqual(out, fx.expected)
    ? { ok: true }
    : { ok: false, detail: `got ${JSON.stringify(out)}` };
}

// ── last-audio-request: strict web→native retranscription relay ──
function validateLastAudioRequest(fx: Fixture): Verdict {
  const out = nativeLastAudioRequestFromDetail(fx.input);
  return deepEqual(out, fx.expected)
    ? { ok: true }
    : { ok: false, detail: `got ${JSON.stringify(out)}` };
}

// ── speech-command: strict native→web barge-in command ──
function validateSpeechCommand(fx: Fixture): Verdict {
  const out = nativeSpeechCommandFromDetail(fx.input);
  return deepEqual(out, fx.expected)
    ? { ok: true }
    : { ok: false, detail: `got ${JSON.stringify(out)}` };
}

// ── receipt: the web-encoded Receipt; native decode drops `deduplicated` ──
function isValidReceipt(r: unknown): r is Dict {
  if (!isDict(r)) return false;
  if (typeof r.emissionId !== "string") return false;
  if (r.disposition === "sent") return typeof r.deduplicated === "boolean";
  if (r.disposition === "queued") return true;
  if (r.disposition === "rejected") return typeof r.reason === "string";
  return false;
}
function validateReceipt(fx: Fixture): Verdict {
  if (!isValidReceipt(fx.input)) return { ok: false, detail: `not a valid Receipt: ${JSON.stringify(fx.input)}` };
  const r = fx.input;
  const projected: Dict = { disposition: r.disposition, emissionId: r.emissionId };
  if (typeof r.reason === "string") projected.reason = r.reason;
  if (typeof r.definitive === "boolean") projected.definitive = r.definitive;
  return deepEqual(projected, fx.expected)
    ? { ok: true }
    : { ok: false, detail: `native projection ${JSON.stringify(projected)} != expected ${JSON.stringify(fx.expected)}` };
}
```

```ts setup
// ── location: toggle request, result, and unsolicited current state ──
function validateLocation(fx: Fixture): Verdict {
  if (fx.variant === "request") {
    const input = dict(fx.input);
    const rawId = input.id;
    const action = input.action;
    const got = typeof rawId === "string" && rawId.length > 0 && action === "toggle" ? { id: rawId, action } : null;
    return deepEqual(got, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
  }
  if (fx.variant === "result") {
    const r = dict(fx.input);
    if (typeof r.id !== "string" || typeof r.success !== "boolean" || typeof r.enabled !== "boolean" || typeof r.message !== "string") {
      return { ok: false, detail: `malformed location result ${JSON.stringify(r)}` };
    }
    return deepEqual(r, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(r)}` };
  }
  if (fx.variant === "state") {
    const r = dict(fx.input);
    const got = typeof r.enabled === "boolean" ? { enabled: r.enabled } : null;
    return deepEqual(got, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
  }
  return { ok: false, detail: `unknown location variant ${JSON.stringify(fx.variant)}` };
}

function validateNarrationState(fx: Fixture): Verdict {
  const input = dict(fx.input);
  const got = typeof input.enabled === "boolean" ? { enabled: input.enabled } : null;
  return deepEqual(got, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
}

// ── hq-dictation-state (contract §4.4a): `diarized` absent reads false; `enabled` is ignored ──
function validateHqDictationState(fx: Fixture): Verdict {
  const { diarized = false } = dict(fx.input);
  const got = typeof diarized === "boolean" ? { diarized } : null;
  return deepEqual(got, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
}

// ── pairing-url: a contract-faithful parse of beebox://pair (contract §1.1) ──
function parsePairingURL(raw: string): Dict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { accepted: false };
  }
  if (url.protocol !== "beebox:" || url.host !== "pair") return { accepted: false };
  const p = url.searchParams;
  const baseURLString = p.get("baseURL") ?? p.get("url");
  if (!baseURLString) return { accepted: false };
  let baseURL: URL;
  try {
    baseURL = new URL(baseURLString);
  } catch {
    return { accepted: false };
  }
  if (!baseURL.protocol || !baseURL.host) return { accepted: false };
  const result: Dict = { accepted: true, baseURL: baseURLString, label: p.get("label") ?? "Bee Box" };
  const token = p.get("pairingToken") ?? p.get("token");
  if (token) result.pairingToken = token;
  const session = p.get("session");
  if (session) result.session = session;
  const authToken = p.get("authToken");
  if (authToken) result.authToken = authToken; // DEBUG-build-only carrier (contract §1.1)
  return result;
}
function validatePairingURL(fx: Fixture): Verdict {
  const got = parsePairingURL(String(fx.input));
  return deepEqual(got, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
}

// ── redeem: POST /api/pairing/redeem request/response/error shapes (contract §1.3) ──
function validateRedeem(fx: Fixture): Verdict {
  const r = dict(fx.input);
  if (fx.variant === "request") {
    if (typeof r.pairingToken !== "string" || r.pairingToken.length === 0) {
      return { ok: false, detail: "pairingToken must be a non-empty string" };
    }
    if (r.deviceLabel !== undefined && typeof r.deviceLabel !== "string") {
      return { ok: false, detail: "deviceLabel must be a string when present" };
    }
    return deepEqual(r, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(r)}` };
  }
  if (fx.variant === "response") {
    if (typeof r.token !== "string" || r.token.length === 0) return { ok: false, detail: "response must carry a token" };
    for (const k of fx.ignoredByClient ?? []) {
      if (!(k in r)) return { ok: false, detail: `expected ignored field ${k} in the wire body` };
      if (k in dict(fx.expected)) return { ok: false, detail: `ignored field ${k} leaked into the client-read expected` };
    }
    return deepEqual({ token: r.token }, fx.expected)
      ? { ok: true }
      : { ok: false, detail: `client reads ${JSON.stringify({ token: r.token })}` };
  }
  if (fx.variant === "error") {
    if (fx.status !== 401) return { ok: false, detail: `expected status 401, got ${JSON.stringify(fx.status)}` };
    if (typeof r.error !== "string" || r.error.length === 0) return { ok: false, detail: "error body must carry a message" };
    return deepEqual(r, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(r)}` };
  }
  return { ok: false, detail: `unknown redeem variant ${JSON.stringify(fx.variant)}` };
}

// ── push-token: POST /api/pairing/push-token through the route's own body schema (contract §5.9) ──
// A 400 case is a body the schema must refuse; the 401 case is the error body shape.
function validatePushToken(fx: Fixture): Verdict {
  if (fx.variant === "request") {
    const parsed = PushTokenBody.safeParse(fx.input);
    if (!parsed.success) return { ok: false, detail: `refused: ${parsed.error.issues[0]?.message}` };
    return deepEqual(parsed.data, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(parsed.data)}` };
  }
  if (fx.variant === "error" && fx.status === 400) {
    return PushTokenBody.safeParse(fx.input).success ? { ok: false, detail: "the schema accepted a body it must refuse" } : { ok: true };
  }
  if (fx.variant === "error" && fx.status === 401) {
    return typeof dict(fx.input).error === "string" && deepEqual(fx.input, fx.expected) ? { ok: true } : { ok: false, detail: "bad 401 body" };
  }
  return { ok: false, detail: `unknown push-token case ${JSON.stringify([fx.variant, fx.status])}` };
}

const apnsFixtureInput = z.object({
  intent: z.object({
    id: z.string(), title: z.string(), body: z.string(), target: z.string(),
    loudness: z.enum(LOUDNESS), tag: z.string().optional(), source: z.string(),
  }),
  bundleId: z.string(),
  box: z.string(),
});
// ── apns-payload: the box's APNs body and headers, which the iOS client reads (contract §5.10) ──
function validateApnsPayload(fx: Fixture): Verdict {
  const { intent, bundleId, box } = apnsFixtureInput.parse(fx.input);
  const got = buildApnsRequest({ ...intent, target: parseTarget(intent.target) }, { bundleId, box });
  return deepEqual(got, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
}

// ── speech-keywords: the real web keyword functions (mirrored by iOS) ──
const keywordInput = z.object({
  transcript: z.string(),
  atStart: z.boolean().optional(),
  action: z.enum(["send", "sendClose", "sendCheckpoint"]).optional(),
  matchedPhrase: z.string().optional(),
});
function validateSpeechKeyword(fx: Fixture): Verdict {
  const input = keywordInput.parse(fx.input);
  if (fx.op === "detect") {
    const result = detectKeyword(input.transcript, input.atStart ? { atStart: true } : undefined);
    if (fx.expected === null) {
      return result === null ? { ok: true } : { ok: false, detail: `expected null, got ${JSON.stringify(result)}` };
    }
    if (result === null) return { ok: false, detail: "expected a match, got null" };
    const expected = dict(fx.expected);
    const actual: Dict = { ...result };
    for (const key of Object.keys(expected)) {
      if (actual[key] !== expected[key]) {
        return { ok: false, detail: `${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}` };
      }
    }
    return { ok: true };
  }
  if (fx.op === "append") {
    if (input.action === undefined || input.matchedPhrase === undefined) {
      return { ok: false, detail: "append needs action and matchedPhrase" };
    }
    const got = appendSendKeywordTag(input.transcript, { action: input.action, matchedPhrase: input.matchedPhrase });
    return got === fx.expected ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
  }
  return { ok: false, detail: `unknown op ${JSON.stringify(fx.op)}` };
}
```

## emission

V2 is strict: every complete-emission field is required, a malformed item
rejects the whole payload, and an unknown version gets a version-specific
reason. Payloads without `version` retain the documented legacy leniency.

```ts
runFamily("emission", validateEmission)
=> {"family":"emission","cases":15,"pass":15}
```

## composer-command

The web-to-native selection command uses one versioned, strict shape.

```ts
runFamily("composer-command", validateComposerCommand)
=> {"family":"composer-command","cases":9,"pass":9}
```

V2 adds `kind`-discriminated payloads without disturbing V1, which installed iOS
builds still decode. An unknown kind — and an unknown `action` inside a
`point-at-control` payload — is refused rather than guessed at, on both sides:
acting on the interface on a guess is the one thing a pointer must never do.

The result carries the answer. `scan-controls` returns an inventory (an empty
one is a real answer); `point-at-control` returns only that it happened, because
the ring is already drawn on the phone. A control entry from a build older than
`point-at-control` has no `actions` key at all, and absent reads as **none** —
such a build can list a control and cannot act on one, so the dump prints it
without a link rather than promising a pointer that would break on click.

```ts
runFamily("composer-command-result", validateCommandResult)
=> {"family":"composer-command-result","cases":7,"pass":7}
```

The acknowledgement is emitted only after the native draft mutation is
durable; rejection always carries a user-visible reason.

```ts
runFamily("composer-command-ack", validateComposerCommandAcknowledgement)
=> {"family":"composer-command-ack","cases":3,"pass":3}
```

## last-audio-request

The relay that lets the phone answer an agent's retranscription request. Both
ids are required: without `requestId` there is no URL to answer at, and without
`messageId` the answer cannot satisfy the server's echo-and-verify check, so
either one missing is a rejection rather than a best-effort send. `sessionId` is
the relaying tab's own, and is null before the tab has been assigned one.

```ts
runFamily("last-audio-request", validateLastAudioRequest)
=> {"family":"last-audio-request","cases":5,"pass":5}
```

## speech-command

The native record button's barge-in. Strict in both directions it can drift: an
unversioned payload is a pre-contract sender and an unknown `action` is a newer
one, and neither may be guessed at — there is no acknowledgement channel to
report a guess through, so a dropped command stays dropped rather than stopping
speech the sender did not ask to stop.

```ts
runFamily("speech-command", validateSpeechCommand)
=> {"family":"speech-command","cases":4,"pass":4}
```

## receipt

The three dispositions with their per-disposition fields. Each `input` is a
valid `Receipt`; the native decoder projects away `deduplicated` on `sent`.

```ts
runFamily("receipt", validateReceipt)
=> {"family":"receipt","cases":4,"pass":4}
```

## location

Toggle request `{id,action}`, result `{id,success,enabled,message}`, and the
unsolicited current-state payload.

```ts
runFamily("location", validateLocation)
=> {"family":"location","cases":5,"pass":5}
```

## narration-state

The current session's narration flag is mirrored to native without ambiguity:

```ts
runFamily("narration-state", validateNarrationState)
=> {"family":"narration-state","cases":2,"pass":2}
```

## hq-dictation-state

Whether the box's HQ service labels speakers. A payload from web that predates
`diarized` reads as not diarized, and a non-boolean `diarized` drops the
payload. `enabled` is ignored: every dictated message gets the HQ pass
(docs/plans/hq-always.md), and web still sends `enabled: true` only for native
builds from before that change:

```ts
runFamily("hq-dictation-state", validateHqDictationState)
=> {"family":"hq-dictation-state","cases":7,"pass":7}
```

## pairing-url

`beebox://pair` parse cases: full params, `url`/`token` aliases, missing and
scheme-less `baseURL` rejection, a `session` param, and the DEBUG-only `authToken`.

```ts
runFamily("pairing-url", validatePairingURL)
=> {"family":"pairing-url","cases":6,"pass":6}
```

## redeem

`POST /api/pairing/redeem` request body, the 200 response (with the fields the
client ignores), and the 401 error body.

```ts
runFamily("redeem", validateRedeem)
=> {"family":"redeem","cases":3,"pass":3}
```

## push-token

`POST /api/pairing/push-token` bodies run through the route's own schema: a
sandbox and a production registration (an uppercase token is stored
lowercase), two bodies it refuses with 400, and the 401 error body.
`test/webapp/routes/pairing.push-token.doctest.md` posts the same request
fixtures at the real route.

```ts
runFamily("push-token", validatePushToken)
=> {"family":"push-token","cases":5,"pass":5}
```

## apns-payload

The APNs body and headers for each loudness, built by the box's own builder.
The iOS client reads `target`, `loudness`, and `notificationId` beside `aps`.

```ts
runFamily("apns-payload", validateApnsPayload)
=> {"family":"apns-payload","cases":3,"pass":3}
```

## speech-keywords

The voice keyword vectors that used to be transcribed by hand into
`SpeechKeywordsTests.swift`, now shared fixtures: send / send-and-close / control
commands, no-match cases, `atStart` gating, and `appendSendKeywordTag`
re-injection (including XML-escaped phrases).

```ts
runFamily("speech-keywords", validateSpeechKeyword)
=> {"family":"speech-keywords","cases":52,"pass":52}
```

## Conversation binding publication

```ts
runFamily("composer-binding", (fixture) => ({
  ok: composerBindingPublicationSchema.safeParse(fixture.input).success === fixture.expectedValid,
}));
// => '{"family":"composer-binding","cases":6,"pass":6}'
```

```ts
runFamily("native-emission-v3", (fixture) => ({
  ok: parseNativeEmissionDetail(fixture.input).ok === fixture.expectedValid,
}));
// => '{"family":"native-emission-v3","cases":3,"pass":3}'
```
