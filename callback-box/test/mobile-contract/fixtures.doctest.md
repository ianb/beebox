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
shapes. One family lives elsewhere on the web side: `debug-log-submit` is POSTed
verbatim at the real route by `test/webapp/debug-log-submit.doctest.md`, because
its server-side consumer is an HTTP endpoint rather than a parser.

```ts setup
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { nativeEmissionFromDetail, parseNativeEmissionDetail } from "../../src/frontend/src/components/chat/native-emission.js";
import { nativeComposerCommandAcknowledgementFromDetail, nativeComposerCommandFromDetail } from "../../src/frontend/src/components/chat/native-composer-command.js";
import { detectKeyword, appendSendKeywordTag } from "../../src/frontend/src/lib/audio/speech-keywords.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFamily(family) {
  const dir = join(FIXTURES_DIR, family);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, fixture: JSON.parse(readFileSync(join(dir, file), "utf-8")) }));
}

// Order-insensitive structural equality (object keys sorted, array order kept).
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
    return out;
  }
  return v;
}
function deepEqual(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

// Run one family's fixtures through a validator. Throws with per-case detail on
// any mismatch (a loud regression); otherwise returns the summary line.
function runFamily(family, validate) {
  const entries = loadFamily(family);
  const failures = [];
  for (const { file, fixture } of entries) {
    let result;
    try {
      result = validate(fixture);
    } catch (e) {
      result = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    if (!result.ok) failures.push(`${file}: ${result.detail}`);
  }
  if (failures.length > 0) throw new Error(`${family} fixtures failed:\n${failures.join("\n")}`);
  return JSON.stringify({ family, cases: entries.length, pass: entries.length });
}
```

```ts setup
// ── emission: the web decoder, documented-lenient (contract §4.1) ──
function validateEmission(fx) {
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
    return deepEqual(out, { ...fx.expected, id: out.id })
      ? { ok: true }
      : { ok: false, detail: `got ${JSON.stringify(out)}` };
  }
  return deepEqual(out, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(out)}` };
}

// ── composer-command: strict web→native add-selection command ──
function validateComposerCommand(fx) {
  const out = nativeComposerCommandFromDetail(fx.input);
  return deepEqual(out, fx.expected)
    ? { ok: true }
    : { ok: false, detail: `got ${JSON.stringify(out)}` };
}

// ── composer-command-ack: strict native→web mutation result ──
function validateComposerCommandAcknowledgement(fx) {
  const out = nativeComposerCommandAcknowledgementFromDetail(fx.input);
  return deepEqual(out, fx.expected)
    ? { ok: true }
    : { ok: false, detail: `got ${JSON.stringify(out)}` };
}

// ── receipt: the web-encoded Receipt; native decode drops `deduplicated` ──
function isValidReceipt(r) {
  if (!r || typeof r !== "object") return false;
  if (typeof r.emissionId !== "string") return false;
  if (r.disposition === "sent") return typeof r.deduplicated === "boolean";
  if (r.disposition === "queued") return true;
  if (r.disposition === "rejected") return typeof r.reason === "string";
  return false;
}
function validateReceipt(fx) {
  if (!isValidReceipt(fx.input)) return { ok: false, detail: `not a valid Receipt: ${JSON.stringify(fx.input)}` };
  const r = fx.input;
  const projected = { disposition: r.disposition, emissionId: r.emissionId };
  if (typeof r.reason === "string") projected.reason = r.reason;
  return deepEqual(projected, fx.expected)
    ? { ok: true }
    : { ok: false, detail: `native projection ${JSON.stringify(projected)} != expected ${JSON.stringify(fx.expected)}` };
}
```

```ts setup
// ── location: toggle request, result, and unsolicited current state ──
function validateLocation(fx) {
  if (fx.variant === "request") {
    const rawId = fx.input.id;
    const action = fx.input.action;
    const got = typeof rawId === "string" && rawId.length > 0 && action === "toggle" ? { id: rawId, action } : null;
    return deepEqual(got, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
  }
  if (fx.variant === "result") {
    const r = fx.input;
    if (typeof r.id !== "string" || typeof r.success !== "boolean" || typeof r.enabled !== "boolean" || typeof r.message !== "string") {
      return { ok: false, detail: `malformed location result ${JSON.stringify(r)}` };
    }
    return deepEqual(r, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(r)}` };
  }
  if (fx.variant === "state") {
    const r = fx.input;
    const got = typeof r.enabled === "boolean" ? { enabled: r.enabled } : null;
    return deepEqual(got, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
  }
  return { ok: false, detail: `unknown location variant ${JSON.stringify(fx.variant)}` };
}

function validateNarrationState(fx) {
  const got = typeof fx.input.enabled === "boolean" ? { enabled: fx.input.enabled } : null;
  return deepEqual(got, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
}

// ── pairing-url: a contract-faithful parse of callbackbox://pair (contract §1.1) ──
function parsePairingURL(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { accepted: false };
  }
  if (url.protocol !== "callbackbox:" || url.host !== "pair") return { accepted: false };
  const p = url.searchParams;
  const baseURLString = p.get("baseURL") ?? p.get("url");
  if (!baseURLString) return { accepted: false };
  let baseURL;
  try {
    baseURL = new URL(baseURLString);
  } catch {
    return { accepted: false };
  }
  if (!baseURL.protocol || !baseURL.host) return { accepted: false };
  const result = { accepted: true, baseURL: baseURLString, label: p.get("label") ?? "Callback Box" };
  const token = p.get("pairingToken") ?? p.get("token");
  if (token) result.pairingToken = token;
  const session = p.get("session");
  if (session) result.session = session;
  const authToken = p.get("authToken");
  if (authToken) result.authToken = authToken; // DEBUG-build-only carrier (contract §1.1)
  return result;
}
function validatePairingURL(fx) {
  const got = parsePairingURL(fx.input);
  return deepEqual(got, fx.expected) ? { ok: true } : { ok: false, detail: `got ${JSON.stringify(got)}` };
}

// ── redeem: POST /api/pairing/redeem request/response/error shapes (contract §1.3) ──
function validateRedeem(fx) {
  const r = fx.input;
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
      if (k in fx.expected) return { ok: false, detail: `ignored field ${k} leaked into the client-read expected` };
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

// ── speech-keywords: the real web keyword functions (mirrored by iOS) ──
function validateSpeechKeyword(fx) {
  if (fx.op === "detect") {
    const result = detectKeyword(fx.input.transcript, fx.input.atStart ? { atStart: true } : undefined);
    if (fx.expected === null) {
      return result === null ? { ok: true } : { ok: false, detail: `expected null, got ${JSON.stringify(result)}` };
    }
    if (result === null) return { ok: false, detail: "expected a match, got null" };
    for (const key of Object.keys(fx.expected)) {
      if (result[key] !== fx.expected[key]) {
        return { ok: false, detail: `${key}: expected ${JSON.stringify(fx.expected[key])}, got ${JSON.stringify(result[key])}` };
      }
    }
    return { ok: true };
  }
  if (fx.op === "append") {
    const got = appendSendKeywordTag(fx.input.transcript, {
      action: fx.input.action,
      matchedPhrase: fx.input.matchedPhrase,
    });
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
=> {"family":"emission","cases":9,"pass":9}
```

## composer-command

The web-to-native selection command uses one versioned, strict shape.

```ts
runFamily("composer-command", validateComposerCommand)
=> {"family":"composer-command","cases":3,"pass":3}
```

The acknowledgement is emitted only after the native draft mutation is
durable; rejection always carries a user-visible reason.

```ts
runFamily("composer-command-ack", validateComposerCommandAcknowledgement)
=> {"family":"composer-command-ack","cases":3,"pass":3}
```

## receipt

The three dispositions with their per-disposition fields. Each `input` is a
valid `Receipt`; the native decoder projects away `deduplicated` on `sent`.

```ts
runFamily("receipt", validateReceipt)
=> {"family":"receipt","cases":3,"pass":3}
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

## pairing-url

`callbackbox://pair` parse cases: full params, `url`/`token` aliases, missing and
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

## speech-keywords

The voice keyword vectors that used to be transcribed by hand into
`SpeechKeywordsTests.swift`, now shared fixtures: send / send-and-close / control
commands, no-match cases, `atStart` gating, and `appendSendKeywordTag`
re-injection (including XML-escaped phrases).

```ts
runFamily("speech-keywords", validateSpeechKeyword)
=> {"family":"speech-keywords","cases":37,"pass":37}
```
