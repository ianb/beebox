# Quick chat candidates and provisional policy

```ts setup
import { buildRoutingCandidates, loadRoutingRubric, boundRoutingContexts, formatRecentRoutingContext, routingHistoryMetadata } from "../../../../src/core/chat/routing/catalog.js";
import { routingCandidateSchema } from "../../../../src/core/chat/routing/policy.js";
import { selectRoutingDestination } from "../../../../src/core/chat/routing/policy.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
const now = Date.parse("2026-09-21T12:00:00Z");
const landmark = { path: "_content/Garden/Garden.landmark.card", dir: "_content/Garden", label: "Garden", symbol: null, prominence: null };
function session(id: string, age: number, dir = "") {
  return { sessionId: id, contextDir: dir, mtime: new Date(now - age * 86400000), huskPath: `_content/${id}.chat.card`, label: id };
}
const sessions = [session("recent", 1), session("old-root", 30), session("garden-latest", 20, landmark.dir), session("garden-old", 40, landmark.dir)];
const base = { sessions, landmarks: [landmark], rubric: { destinations: [] }, now };
```

Recent web chats and the latest landmark chat remain distinct from starting a new chat there.

```ts
const candidates = buildRoutingCandidates(base);
JSON.stringify(candidates.map((candidate) => [candidate.label, candidate.target.kind]))
=> [["recent","existing-session"],["garden-latest","existing-session"],["New chat in Garden","new-session"],["New general chat","new-session"]]

const kept = buildRoutingCandidates({ ...base, rubric: { destinations: [{ target: "/_content/old-root.chat.card", when: "Long-term planning", keepEligible: true }] } });
kept.some((candidate) => candidate.label === "old-root")
=> true

buildRoutingCandidates({ ...base, rubric: { destinations: [{ target: "/_content/deleted.chat.card", when: "Old topic", keepEligible: true }] } })
=> throws RoutingCatalogError: Chat routing rubric target is unavailable: /_content/deleted.chat.card

buildRoutingCandidates({ ...base, sessions: Array.from({ length: 254 }, (_, i) => session(String(i), 0)) })
=> throws RoutingCatalogError: Too many eligible chats for routing. Copy your text into a chat using Chats.
```

Background landmarks are excluded unless the rubric explicitly opts in. A deleted or unavailable session is absent from the supplied live-owner list.

```ts
const hidden = { ...landmark, prominence: "background" as const };
JSON.stringify(buildRoutingCandidates({ ...base, landmarks: [hidden] }).map((candidate) => candidate.label))
=> ["recent","New general chat"]

buildRoutingCandidates({ ...base, landmarks: [hidden], rubric: { destinations: [{ target: "/_content/Garden/Garden.landmark.card", when: "Garden discussion" }] } }).some((candidate) => candidate.label === "garden-latest")
=> true
```

Near-ties favor continuing an existing chat. The raw ranking remains visible. A strong new topic wins. An uncertain distribution still selects a chat; root is always available.

```ts
const candidates = buildRoutingCandidates(base);
const near = selectRoutingDestination({ candidates, probabilities: { c0: 0.38, c1: 0.08, c2: 0.44, c3: 0.1 } });
JSON.stringify([near.selected.id, near.ranked[0]?.candidate.id, near.preferenceApplied])
=> ["c0","c2",true]

selectRoutingDestination({ candidates, probabilities: { c0: 0.2, c1: 0.05, c2: 0.65, c3: 0.1 } }).selected.id
=> c2

selectRoutingDestination({ candidates, probabilities: { c0: 0.1, c1: 0.1, c2: 0.1, c3: 0.7 } }).selected.target.kind
=> new-session

selectRoutingDestination({ candidates, probabilities: { c0: 0.4, c1: 0.1, c2: 0.4, c3: 0.1 }, existingMargin: 0 }).selected.id
=> c0
```

Even an empty box has a routable root destination.

```ts
const empty = buildRoutingCandidates({ sessions: [], landmarks: [], rubric: { destinations: [] }, now });
JSON.stringify(selectRoutingDestination({ candidates: empty, probabilities: { c0: 1 } }).selected.target)
=> {"kind":"new-session","contextDir":""}
```

An absent rubric is valid. A malformed rubric stops routing, rather than discarding authored rules.

```ts
const boxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "routing-rubric-"));
JSON.stringify(await loadRoutingRubric(boxRoot))
=> {"destinations":[]}

await fs.mkdir(path.join(boxRoot, "_config"));
await fs.writeFile(path.join(boxRoot, "_config/chat-routing.yaml"), "destinations:\n  - target: /_content/garden.chat.card\n    when: Garden decisions\n    keepEligible: true\n");
(await loadRoutingRubric(boxRoot)).destinations[0]?.when
=> Garden decisions

await fs.writeFile(path.join(boxRoot, "_config/chat-routing.yaml"), "destinations: wrong\n");
await loadRoutingRubric(boxRoot)
=> throws RoutingCatalogError: Chat routing rubric is invalid. Check _config/chat-routing.yaml.

await fs.writeFile(path.join(boxRoot, "_config/chat-routing.yaml"), "destinations: [\n");
await loadRoutingRubric(boxRoot)
=> throws RoutingCatalogError: Chat routing rubric is invalid. Check _config/chat-routing.yaml.
```

```ts cleanup
await fs.rm(boxRoot, { recursive: true, force: true });
```

## Aggregate context budget

All eligible destinations survive budgeting. Ordinary text shares 32,000
characters; each excerpt remains at most 2,000 characters. Original candidates
remain unchanged, and truncated evidence is explicit.

```ts
const many = buildRoutingCandidates({ ...base, sessions: Array.from({ length: 40 }, (_, i) => session(String(i), 0)) });
const full = many.map(candidate => candidate.target.kind === "existing-session" ? { ...candidate, recentContext: "x".repeat(2000) } : candidate);
const bounded = boundRoutingContexts(full);
JSON.stringify([bounded.length === full.length, bounded.reduce((sum, candidate) => sum + (candidate.recentContext?.length ?? 0), 0), bounded.filter(candidate => candidate.contextTruncated).length, full[0]?.recentContext?.length])
=> [true,32000,40,2000]

const escaped = full.map(candidate => candidate.target.kind === "existing-session" ? { ...candidate, recentContext: "\u0001".repeat(2000) } : candidate);
const encoded = boundRoutingContexts(escaped);
JSON.stringify([encoded.length === full.length, JSON.stringify(encoded).length <= 60000, encoded.every(candidate => (candidate.recentContext?.length ?? 0) <= 2000)])
=> [true,true,true]

boundRoutingContexts(full.map(candidate => ({ ...candidate, rubric: [{ when: "x".repeat(60001) }] })))
=> throws RoutingCatalogError: Chat routing rules and destination details exceed the request budget. Shorten the rubric, or copy your text into a chat using Chats.

boundRoutingContexts([{ ...full[0]!, recentContext: "Short context", contextTruncated: true }])[0]?.contextTruncated
=> true
```

Recent excerpts preserve message roles and boundaries, with the latest user
intent kept even when assistant output fills the tail. The same rule applies in
the aggregate serialized-budget pass.

```ts
const transcript = [
  { uuid: "1", type: "user" as const, timestamp: "2026-09-21T11:00:00Z", content: [{ type: "text" as const, text: "<typed>Earlier request</typed>" }] },
  { uuid: "2", type: "assistant" as const, timestamp: "2026-09-21T11:01:00Z", content: [{ type: "text" as const, text: "A".repeat(1900) }] },
  { uuid: "3", type: "user" as const, timestamp: "2026-09-21T11:02:00Z", content: [{ type: "text" as const, text: `<chat-app snapshot="${"x".repeat(2300)}"/><typed user="human" user-email="human@example.test">Can we continue the established garden redesign and compare the soil notes?</typed>` }] },
  { uuid: "4", type: "assistant" as const, timestamp: "2026-09-21T11:03:00Z", content: [{ type: "text" as const, text: "B".repeat(3000) }] },
  { uuid: "5", type: "assistant" as const, timestamp: "2026-09-21T11:04:00Z", content: [] },
];
const excerpt = formatRecentRoutingContext(transcript);
JSON.stringify([excerpt.length <= 2000, excerpt.includes("] user: Can we continue"), excerpt.includes("</typed>"), excerpt.includes("] assistant: B"), excerpt.includes("[truncated]"), excerpt.includes("Earlier request")])
=> [true,true,false,true,true,false]

const gapTranscript = [transcript[0]!, transcript[1]!, transcript[2]!, { ...transcript[3]!, content: [{ type: "text" as const, text: "B".repeat(1000) }] }];
formatRecentRoutingContext(gapTranscript, 1300).includes("Earlier request")
=> false

const legacyTranscript = [{ uuid: "legacy", type: "user" as const, timestamp: "2026-09-21T11:05:00Z", content: [{ type: "text" as const, text: "Legacy unwrapped question" }] }];
formatRecentRoutingContext(legacyTranscript)
=> [2026-09-21T11:05:00Z] user: Legacy unwrapped question

JSON.stringify(routingHistoryMetadata(96, transcript))
=> {"totalEntries":96,"lastMessageAt":"2026-09-21T11:03:00.000Z"}

const candidate = buildRoutingCandidates({ ...base, sessions: [session("one", 0)] })[0]!;
const secondBound = boundRoutingContexts([{ ...candidate, recentContext: excerpt, totalEntries: 42, lastMessageAt: "2026-09-21T11:03:00.000Z" }], 750)[0]!;
JSON.stringify([ (secondBound.recentContext?.length ?? 0) <= 750, secondBound.recentContext?.includes("] user: Can we continue"), secondBound.recentContext?.includes("] assistant: B"), secondBound.totalEntries, secondBound.lastMessageAt])
=> [true,true,true,42,"2026-09-21T11:03:00.000Z"]

JSON.stringify(routingCandidateSchema.parse({ id: "old", label: "Old chat", target: { kind: "existing-session", sessionId: "old", contextDir: "" } }))
=> {"id":"old","label":"Old chat","target":{"kind":"existing-session","sessionId":"old","contextDir":""}}
```
