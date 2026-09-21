# Jev service boundary

Jev judgments preserve every enumerated destination. Invalid or incomplete
responses become typed errors; they cannot silently change the candidate set.
These tests use synthetic data and never contact OpenRouter.

```ts setup
import { parseJevResponse, createFakeJev, createJevService, JevError } from "../src/services/jev.js";
const keys = ["garden", "weekend", "new"];
function response(probabilities: unknown, confidence: unknown = 0.8) {
  return { model: "typesafe/jev-1.13-test", answers: { destination: { type: "choice", probabilities, confidence } } };
}
```

A close pair stays close. The service does not impose the application's
preference for an existing session. Rounded distributions remain unchanged.

```ts
JSON.stringify(parseJevResponse(response({ garden: 0.48, weekend: 0.42, new: 0.1 }), keys).probabilities)
=> {"garden":0.48,"weekend":0.42,"new":0.1}

parseJevResponse(response({ garden: 0.333, weekend: 0.333, new: 0.333 }), keys).confidence
=> 0.8

parseJevResponse(response({ garden: 0.33, weekend: 0.33, new: 0.33 }), keys).confidence
=> 0.8

parseJevResponse(response({ garden: 1 }), keys)
=> throws JevError

parseJevResponse(response({ garden: 0.5, weekend: 0.5, unknown: 0 }), keys)
=> throws JevError

parseJevResponse(response({ garden: 0.5, weekend: 0.2, new: 0.1 }), keys)
=> throws JevError

parseJevResponse(response({ garden: NaN, weekend: 0, new: 0 }), keys)
=> throws JevError

parseJevResponse(response({ garden: 1.1, weekend: -0.1, new: 0 }), keys)
=> throws JevError

parseJevResponse(response({ garden: 1, weekend: 0, new: 0 }, Infinity), keys)
=> throws JevError

parseJevResponse(null, keys)
=> throws JevError

parseJevResponse({ model: "test", answers: { destination: { type: "noul", confidence: 1, probabilities: { garden: 1, weekend: 0, new: 0 } } } }, keys)
=> throws JevError
```

The fake records successful and failed calls without needing credentials.

```ts
const input = { state: { message: "raised beds" }, criteria: { garden: "Garden", new: "New chat" } };
const fake = createFakeJev({ result: { model: "test", probabilities: { garden: 0.8, new: 0.2 }, confidence: 0.9 } });
(await fake.decide(input)).probabilities.garden
=> 0.8

fake.describe()
=> calls: 1
[0] garden | new

const failed = createFakeJev({ error: new JevError("scripted failure", "request") });
await failed.decide(input)
=> throws JevError

failed.calls.length
=> 1

const uncertain = createFakeJev();
JSON.stringify((await uncertain.decide(input)).probabilities)
=> {"garden":0.5,"new":0.5}
```

Oversized catalogs fail before any request. No candidates are silently removed.

```ts
const bounded = createJevService({ apiKey: "unused-test-key" });
await bounded.decide({ state: { candidates: "x".repeat(80_001) }, criteria: { existing: "Continue", new: "New" } })
=> throws JevError
```
