# Jev service boundary

Jev judgments preserve every enumerated destination. Invalid or incomplete
responses become typed errors; they cannot silently change the candidate set.
These tests use synthetic data and never contact OpenRouter.

```ts setup
import { parseJevResponse, createFakeJev, createJevService, serializeJevRequest } from "../../src/services/jev.js";
import { JevError } from "../../src/services/jev-wire.js";
import { parseJudgeResponse, serializeJudgeRequest } from "../../src/services/jev-judge.js";
import { boundRoutingContexts } from "../../src/core/chat/routing/catalog.js";
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

## Whole-request budgeting preserves candidates with escaped captured text

The budget includes the captured message, criterion descriptions, fixed prompt,
and JSON escaping. Large catalogs shorten transcript evidence instead of losing
destinations. These fixtures use the route's criterion descriptions and a
maximum-length captured message containing backslashes and newlines.

```ts
const escapedMessage = "garden\\\n".repeat(1500);
escapedMessage.length
=> 12000

function budgetedRequest(count) {
  const candidates = Array.from({ length: count }, (_, index) => ({
    id: `c${index}`, label: `Chat ${index}`,
    target: { kind: "existing-session", sessionId: `session-${index}`, contextDir: "" },
    recentContext: "user: garden plans\n".repeat(110),
  }));
  const criteria = Object.fromEntries(candidates.map(candidate => [candidate.id, `${candidate.label}: ${candidate.target.kind}. Use the matching candidate in state for its context and rubric.`]));
  const budget = 80000 - serializeJevRequest({ state: { message: escapedMessage, candidates: [] }, criteria }).length + 2;
  const bounded = boundRoutingContexts(candidates, budget);
  const request = serializeJevRequest({ state: { message: escapedMessage, candidates: bounded }, criteria });
  return { candidates, bounded, request };
}
const largeRequests = [budgetedRequest(120), budgetedRequest(200)];
JSON.stringify(largeRequests.map(result => ({
  fits: result.request.length <= 80000,
  count: result.bounded.length,
  identitiesPreserved: result.bounded.every((candidate, index) => candidate.id === result.candidates[index].id && candidate.target.sessionId === result.candidates[index].target.sessionId),
  shortened: result.bounded.every(candidate => candidate.contextTruncated && candidate.recentContext.length < 2000),
})))
=> [{"fits":true,"count":120,"identitiesPreserved":true,"shortened":true},{"fits":true,"count":200,"identitiesPreserved":true,"shortened":true}]

boundRoutingContexts([{ id: "c0", label: "Metadata that cannot fit", target: { kind: "new-session", contextDir: "" } }], 20)
=> throws RoutingCatalogError: Chat routing rules and destination details exceed the request budget. Shorten the rubric, or copy your text into a chat using Chats.
```

## Judgments: Noul, Choice, and Score questions in one call

`judge` sends several named questions over one state. Each question's
instructions are the situation, then the shared instructions, then its own;
`criteria` keeps the wire shape of its type.

```ts
const questions = {
  trip: { type: "noul", instructions: "Only school mail counts.", criteria: { true: "The school wrote about the field trip.", false: "It did not." } },
  kind: { type: "choice", instructions: ["Pick the sender type."], criteria: { school: "The school", shop: "A shop" } },
  urgency: { type: "score", instructions: "How soon must the boxholder act?", criteria: ["No action", "This month", "This week"] },
};
const request = JSON.parse(serializeJudgeRequest({
  situation: "This box belongs to a family of four.",
  instructions: "Judge only what the emails say.",
  questions,
  state: "=== _content/inbox/a.email.card\nPermission slip due Friday",
}));
request.model
=> typesafe/jev-1.13

JSON.stringify(request.questions.trip)
=> {"type":"noul","instructions":["This box belongs to a family of four.","Judge only what the emails say.","Only school mail counts."],"criteria":{"true":"The school wrote about the field trip.","false":"It did not."}}

JSON.stringify(request.questions.kind)
=> {"type":"choice","instructions":["This box belongs to a family of four.","Judge only what the emails say.","Pick the sender type."],"criteria":{"school":"The school","shop":"A shop"}}

JSON.stringify(request.questions.urgency.criteria)
=> ["No action","This month","This week"]
```

A response is parsed per question into typed answers. A missing question, an
extra one, an option that was not offered, or a distribution that does not sum
to one is a `JevError`, never a partial answer.

```ts continue
const good = {
  model: "typesafe/jev-1.13",
  answers: {
    trip: { type: "noul", noul: 0.91 },
    kind: { type: "choice", choice: "school", confidence: 0.8, probabilities: { school: 0.9, shop: 0.1 } },
    urgency: { type: "score", score: 2, confidence: 0.6, probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 }, legend: {} },
  },
};
JSON.stringify(parseJudgeResponse(good, questions).answers)
=> {"trip":{"type":"noul","probability":0.91},"kind":{"type":"choice","choice":"school","confidence":0.8,"probabilities":{"school":0.9,"shop":0.1}},"urgency":{"type":"score","score":2,"confidence":0.6,"probabilities":{"0":0.1,"1":0.2,"2":0.7}}}

parseJudgeResponse({ ...good, answers: { trip: good.answers.trip, kind: good.answers.kind } }, questions)
=> throws JevError: Jev response error: answers did not match the 3 requested questions

parseJudgeResponse({ ...good, answers: { ...good.answers, trip: { type: "noul", noul: 1.2 } } }, questions)
=> throws JevError: Jev response error: question "trip" has an invalid noul probability

parseJudgeResponse({ ...good, answers: { ...good.answers, kind: { ...good.answers.kind, choice: "bank" } } }, questions)
=> throws JevError: Jev response error: question "kind" chose an option it was not offered

parseJudgeResponse({ ...good, answers: { ...good.answers, kind: { ...good.answers.kind, probabilities: { school: 0.5, shop: 0.2 } } } }, questions)
=> throws JevError: Jev response error: question "kind" probabilities summed to 0.7

parseJudgeResponse({ ...good, answers: { ...good.answers, urgency: { ...good.answers.urgency, probabilities: { "0": 0.5, "1": 0.5 } } } }, questions)
=> throws JevError: Jev response error: question "urgency" distribution keys did not match its 3 options

parseJudgeResponse({ ...good, answers: { ...good.answers, trip: { type: "choice", choice: "school" } } }, questions)
=> throws JevError: Jev response error: question "trip" answer is missing or not a noul
```

The fake scripts answers per question and passes them through the same parser,
so a scripted answer the real service would reject fails in the fake too.
Unscripted, it has no opinion.

```ts continue
const uncertain = (question) => question.type === "choice"
  ? { type: "choice", choice: "shop", confidence: 0.1, probabilities: { school: 0.5, shop: 0.5 } }
  : { type: "score", score: 0, confidence: 0.1, probabilities: { "0": 0.4, "1": 0.3, "2": 0.3 } };
const judge = createFakeJev({
  answers: (name, { question, state }) =>
    name === "trip" ? { type: "noul", probability: String(state).includes("Permission") ? 0.95 : 0.05 } : uncertain(question),
});
const judged = await judge.judge({ instructions: "Judge the emails.", questions, state: "Permission slip due Friday" });
JSON.stringify(judged.answers.trip)
=> {"type":"noul","probability":0.95}

judge.describe()
=> calls: 0
judge[0] trip:noul kind:choice urgency:score

const unsure = createFakeJev();
JSON.stringify((await unsure.judge({ instructions: "x", questions, state: "" })).answers)
=> {"trip":{"type":"noul","probability":0.5},"kind":{"type":"choice","choice":"school","confidence":0,"probabilities":{"school":0.5,"shop":0.5}},"urgency":{"type":"score","score":1,"confidence":0,"probabilities":{"0":0.3333333333333333,"1":0.3333333333333333,"2":0.3333333333333333}}}

const badScript = createFakeJev({ answers: () => ({ type: "noul", probability: 2 }) });
await badScript.judge({ instructions: "x", questions: { trip: questions.trip }, state: "" })
=> throws JevError

await createFakeJev({ error: new JevError("scripted failure", "request") }).judge({ instructions: "x", questions, state: "" })
=> throws JevError
```
