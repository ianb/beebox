// # Quick chat candidates and provisional policy

import { test } from "tap";
import "agent-doctest/tap";
import { buildRoutingCandidates, loadRoutingRubric, boundRoutingContexts, formatRecentRoutingContext, routingHistoryMetadata } from "../../../../../src/core/chat/routing/quick-chat-submit/catalog.js";
import { routingCandidateSchema } from "../../../../../src/core/chat/routing/policy.js";
import { selectRoutingDestination } from "../../../../../src/core/chat/routing/policy.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const now = Date.parse("2026-09-21T12:00:00Z");
const landmark = { path: "_content/Garden/Garden.landmark.card", dir: "_content/Garden", label: "Garden", symbol: null, prominence: null };
function session({ id, age, dir }: { id: string; age: number; dir?: string }) {
  return { sessionId: id, contextDir: dir ?? "", mtime: new Date(now - age * 86400000), huskPath: `_content/${id}.chat.card`, label: id };
}
const sessions = [
  session({ id: "recent", age: 1 }),
  session({ id: "old-root", age: 30 }),
  session({ id: "garden-latest", age: 20, dir: landmark.dir }),
  session({ id: "garden-old", age: 40, dir: landmark.dir }),
];
/** The `lastActivity` a session of this age in days reports. */
const active = (age: number) => new Date(now - age * 86400000).toISOString();
const gardenLandmark = { path: "_content/Garden/Garden.landmark.card", label: "Garden" };
const recentCandidate = { id: "c0", label: "recent", target: { kind: "existing-session", sessionId: "recent", contextDir: "" }, lastActivity: active(1) } as const;
const base = { sessions, landmarks: [landmark], rubric: { destinations: [] }, now };

// Recent web chats and the latest landmark chat remain distinct from starting a new chat there.
void test("Recent web chats and the latest landmark chat remain distinct from starting a...", async (t) => {
  // doctest:L22
  const candidates = buildRoutingCandidates(base);
  t.check(candidates, [
    recentCandidate,
    { id: "c1", label: "garden-latest", target: { kind: "existing-session", sessionId: "garden-latest", contextDir: "_content/Garden" }, lastActivity: active(20), landmark: gardenLandmark },
    { id: "c2", label: "New chat in Garden", target: { kind: "new-session", contextDir: "_content/Garden" }, landmark: gardenLandmark },
    { id: "c3", label: "New general chat", target: { kind: "new-session", contextDir: "" } },
  ]);

  // doctest:L26
  const kept = buildRoutingCandidates({ ...base, rubric: { destinations: [{ target: "/_content/old-root.chat.card", when: "Long-term planning", keepEligible: true }] } });
  t.check(kept, [
    recentCandidate,
    { id: "c1", label: "garden-latest", target: { kind: "existing-session", sessionId: "garden-latest", contextDir: "_content/Garden" }, lastActivity: active(20), landmark: gardenLandmark },
    {
      id: "c2", label: "old-root", target: { kind: "existing-session", sessionId: "old-root", contextDir: "" }, lastActivity: active(30),
      rubric: [{ when: "Long-term planning", avoid: undefined, examples: undefined }],
    },
    { id: "c3", label: "New chat in Garden", target: { kind: "new-session", contextDir: "_content/Garden" }, landmark: gardenLandmark },
    { id: "c4", label: "New general chat", target: { kind: "new-session", contextDir: "" } },
  ]);

  // doctest:L30
  await t.checkThrows(async () => (buildRoutingCandidates({ ...base, rubric: { destinations: [{ target: "/_content/deleted.chat.card", when: "Old topic", keepEligible: true }] } })), "RoutingCatalogError: Chat routing rubric target is unavailable: /_content/deleted.chat.card");

  // doctest:L33
  await t.checkThrows(async () => (buildRoutingCandidates({ ...base, sessions: Array.from({ length: 254 }, (_, i) => session({ id: String(i), age: 0 })) })), "RoutingCatalogError: Too many eligible chats for routing. Copy your text into a chat using Chats.");
});

// Background landmarks are excluded unless the rubric explicitly opts in. A deleted or unavailable session is absent from the supplied live-owner list.
void test("Background landmarks are excluded unless the rubric explicitly opts in.", async (t) => {
  // doctest:L40
  const hidden = { ...landmark, prominence: "background" as const };
  t.check(buildRoutingCandidates({ ...base, landmarks: [hidden] }), [
    recentCandidate,
    { id: "c1", label: "New general chat", target: { kind: "new-session", contextDir: "" } },
  ]);

  // doctest:L44
  const gardenRule = [{ when: "Garden discussion", avoid: undefined, examples: undefined }];
  t.check(buildRoutingCandidates({ ...base, landmarks: [hidden], rubric: { destinations: [{ target: "/_content/Garden/Garden.landmark.card", when: "Garden discussion" }] } }), [
    recentCandidate,
    { id: "c1", label: "garden-latest", target: { kind: "existing-session", sessionId: "garden-latest", contextDir: "_content/Garden" }, lastActivity: active(20), landmark: gardenLandmark, rubric: gardenRule },
    { id: "c2", label: "New chat in Garden", target: { kind: "new-session", contextDir: "_content/Garden" }, landmark: gardenLandmark, rubric: gardenRule },
    { id: "c3", label: "New general chat", target: { kind: "new-session", contextDir: "" } },
  ]);
});

// Near-ties favor continuing an existing chat, and the raw ranking remains visible. A margin of 0 leaves only exact ties to the existing chat.
void test("Near-ties favor continuing an existing chat, and the raw ranking remains visi...", async (t) => {
  // doctest:L51
  const candidates = buildRoutingCandidates(base);
  const near = selectRoutingDestination({ candidates, probabilities: { c0: 0.38, c1: 0.08, c2: 0.44, c3: 0.1 } });
  const newGarden = { id: "c2", label: "New chat in Garden", target: { kind: "new-session", contextDir: "_content/Garden" }, landmark: gardenLandmark } as const;
  const newGeneral = { id: "c3", label: "New general chat", target: { kind: "new-session", contextDir: "" } } as const;
  const gardenLatest = { id: "c1", label: "garden-latest", target: { kind: "existing-session", sessionId: "garden-latest", contextDir: "_content/Garden" }, lastActivity: active(20), landmark: gardenLandmark } as const;
  t.check(near, {
    selected: recentCandidate,
    ranked: [
      { candidate: newGarden, probability: 0.44 },
      { candidate: recentCandidate, probability: 0.38 },
      { candidate: newGeneral, probability: 0.1 },
      { candidate: gardenLatest, probability: 0.08 },
    ],
    preferenceApplied: true,
  });

  // doctest:L56
  t.check(selectRoutingDestination({ candidates, probabilities: { c0: 0.4, c1: 0.1, c2: 0.4, c3: 0.1 }, existingMargin: 0 }).selected, recentCandidate);
});

// Even an empty box has a routable root destination.
void test("Even an empty box has a routable root destination.", async (t) => {
  // doctest:L63
  const empty = buildRoutingCandidates({ sessions: [], landmarks: [], rubric: { destinations: [] }, now });
  t.check(selectRoutingDestination({ candidates: empty, probabilities: { c0: 1 } }).selected.target, {
    kind: "new-session",
    contextDir: "",
  });
});

// An absent rubric is valid. A malformed rubric stops routing, rather than discarding authored rules.
void test("An absent rubric is valid.", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(boxRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L71
  const boxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "routing-rubric-"));
  t.check(await loadRoutingRubric(boxRoot), {
    destinations: [],
  });

  // doctest:L75
  await fs.mkdir(path.join(boxRoot, "_config"));
  await fs.writeFile(path.join(boxRoot, "_config/chat-routing.yaml"), "destinations:\n  - target: /_content/garden.chat.card\n    when: Garden decisions\n    keepEligible: true\n");
  t.check(await loadRoutingRubric(boxRoot), {
    destinations: [{ target: "/_content/garden.chat.card", when: "Garden decisions", keepEligible: true }],
  });

  // doctest:L80
  await fs.writeFile(path.join(boxRoot, "_config/chat-routing.yaml"), "destinations: wrong\n");
  await t.checkThrows(async () => (await loadRoutingRubric(boxRoot)), "RoutingCatalogError: Chat routing rubric is invalid. Check _config/chat-routing.yaml.");

  // doctest:L84
  await fs.writeFile(path.join(boxRoot, "_config/chat-routing.yaml"), "destinations: [\n");
  await t.checkThrows(async () => (await loadRoutingRubric(boxRoot)), "RoutingCatalogError: Chat routing rubric is invalid. Check _config/chat-routing.yaml.");
});

// ## Aggregate context budget
//
// All eligible destinations survive budgeting. Ordinary text shares 32,000
// characters; each excerpt remains at most 2,000 characters. Original candidates
// remain unchanged, and truncated evidence is explicit.
void test("All eligible destinations survive budgeting.", async (t) => {
  // doctest:L100
  const many = buildRoutingCandidates({ ...base, sessions: Array.from({ length: 40 }, (_, i) => session({ id: String(i), age: 0 })) });
  const full = many.map(candidate => candidate.target.kind === "existing-session" ? { ...candidate, recentContext: "x".repeat(2000) } : candidate);
  const bounded = boundRoutingContexts(full);
  t.check(bounded, full.map((candidate) => candidate.target.kind === "existing-session"
    ? { ...candidate, recentContext: "x".repeat(800), contextTruncated: true }
    : candidate));
  t.check(full[0]?.recentContext, "x".repeat(2000));

  // doctest:L106
  const escaped = full.map(candidate => candidate.target.kind === "existing-session" ? { ...candidate, recentContext: "\u0001".repeat(2000) } : candidate);
  const encoded = boundRoutingContexts(escaped);
  t.check(encoded, full.map((candidate) => candidate.target.kind === "existing-session"
    ? { ...candidate, recentContext: "\u0001".repeat(218), contextTruncated: true }
    : candidate));

  // doctest:L111
  await t.checkThrows(async () => (boundRoutingContexts(full.map(candidate => ({ ...candidate, rubric: [{ when: "x".repeat(60001) }] })))), "RoutingCatalogError: Chat routing rules and destination details exceed the request budget. Shorten the rubric, or copy your text into a chat using Chats.");

  // doctest:L114
  t.check(boundRoutingContexts([{ ...full[0]!, recentContext: "Short context", contextTruncated: true }]), [{ ...full[0]!, recentContext: "Short context", contextTruncated: true }]);
});

// Recent excerpts preserve message roles and boundaries, with the latest user
// intent kept even when assistant output fills the tail. The same rule applies in
// the aggregate serialized-budget pass.
void test("Recent excerpts preserve message roles and boundaries, with the latest user i...", async (t) => {
  // doctest:L123
  const transcript = [
    { uuid: "1", type: "user" as const, timestamp: "2026-09-21T11:00:00Z", content: [{ type: "text" as const, text: "<typed>Earlier request</typed>" }] },
    { uuid: "2", type: "assistant" as const, timestamp: "2026-09-21T11:01:00Z", content: [{ type: "text" as const, text: "A".repeat(1900) }] },
    { uuid: "3", type: "user" as const, timestamp: "2026-09-21T11:02:00Z", content: [{ type: "text" as const, text: `<chat-app snapshot="${"x".repeat(2300)}"/><typed user="human" user-email="human@example.test">Can we continue the established garden redesign and compare the soil notes?</typed>` }] },
    { uuid: "4", type: "assistant" as const, timestamp: "2026-09-21T11:03:00Z", content: [{ type: "text" as const, text: "B".repeat(3000) }] },
    { uuid: "5", type: "assistant" as const, timestamp: "2026-09-21T11:04:00Z", content: [] },
  ];
  const excerpt = formatRecentRoutingContext(transcript);
  t.checkText(excerpt, `[«date»] user: Can we continue the established garden redesign and compare the soil notes?
[«date»] assistant: ${"B".repeat(1848)} …[truncated]`);

  // doctest:L134
  const gapTranscript = [transcript[0]!, transcript[1]!, transcript[2]!, { ...transcript[3]!, content: [{ type: "text" as const, text: "B".repeat(1000) }] }];
  t.checkText(formatRecentRoutingContext(gapTranscript, 1300), `[«date»] user: Can we continue the established garden redesign and compare the soil notes?
[«date»] assistant: ${"B".repeat(1000)}`);

  // doctest:L138
  const legacyTranscript = [{ uuid: "legacy", type: "user" as const, timestamp: "2026-09-21T11:05:00Z", content: [{ type: "text" as const, text: "Legacy unwrapped question" }] }];
  await t.checkText(formatRecentRoutingContext(legacyTranscript), "[2026-09-21T11:05:00Z] user: Legacy unwrapped question");

  // doctest:L142
  t.check(routingHistoryMetadata(96, transcript), {
    totalEntries: 96,
    lastMessageAt: "2026-09-21T11:03:00.000Z",
  });

  // doctest:L145
  const candidate = buildRoutingCandidates({ ...base, sessions: [session({ id: "one", age: 0 })] })[0]!;
  const secondBound = boundRoutingContexts([{ ...candidate, recentContext: excerpt, totalEntries: 42, lastMessageAt: "2026-09-21T11:03:00.000Z" }], 750)[0]!;
  t.check(secondBound, {
    ...candidate,
    recentContext: `[2026-09-21T11:02:00Z] user: Can we continue the established garden redesign and compare the soil notes?\n[2026-09-21T11:03:00Z] assistant: ${"B".repeat(353)} …[truncated]`,
    totalEntries: 42,
    lastMessageAt: "2026-09-21T11:03:00.000Z",
    contextTruncated: true,
  });

  // doctest:L150
  t.check(routingCandidateSchema.parse({ id: "old", label: "Old chat", target: { kind: "existing-session", sessionId: "old", contextDir: "" } }), {
    id: "old",
    label: "Old chat",
    target: {
      kind: "existing-session",
      sessionId: "old",
      contextDir: "",
    },
  });
});
