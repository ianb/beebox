// # Jev service boundary
//
// Jev judgments preserve every enumerated destination. Invalid or incomplete
// responses become typed errors; they cannot silently change the candidate set.
// These tests use synthetic data and never contact OpenRouter.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseJevResponse, createJevService, serializeJevRequest } from "../../src/services/jev.js";
import { parseJudgeResponse, serializeJudgeRequest, type JudgeQuestion } from "../../src/services/jev-judge.js";
import { boundRoutingContexts } from "../../src/core/chat/routing/quick-chat-submit/catalog.js";
import type { RoutingCandidate } from "../../src/core/chat/routing/policy.js";

const keys = ["garden", "weekend", "new"];
function sessionIdOf(candidate: RoutingCandidate | undefined): string | undefined {
  return candidate?.target.kind === "existing-session" ? candidate.target.sessionId : undefined;
}
function response(probabilities: unknown, confidence?: unknown) {
  const reported = confidence === undefined ? 0.8 : confidence;
  return { model: "typesafe/jev-1.13-test", answers: { destination: { type: "choice", probabilities, confidence: reported } } };
}

// A close pair stays close. The service does not impose the application's
// preference for an existing session. Rounded distributions remain unchanged.
void test("A close pair stays close.", async (t) => {
  // doctest:L26
  t.check(parseJevResponse(response({ garden: 0.48, weekend: 0.42, new: 0.1 }), keys).probabilities, {
    garden: 0.48,
    weekend: 0.42,
    new: 0.1,
  });

  // doctest:L29
  t.check(parseJevResponse(response({ garden: 0.333, weekend: 0.333, new: 0.333 }), keys).confidence, 0.8);

  // doctest:L32
  t.check(parseJevResponse(response({ garden: 0.33, weekend: 0.33, new: 0.33 }), keys).confidence, 0.8);

  // doctest:L35
  await t.checkThrows(async () => (parseJevResponse(response({ garden: 1 }), keys)), "JevError");

  // doctest:L38
  await t.checkThrows(async () => (parseJevResponse(response({ garden: 0.5, weekend: 0.5, unknown: 0 }), keys)), "JevError");

  // doctest:L41
  await t.checkThrows(async () => (parseJevResponse(response({ garden: 0.5, weekend: 0.2, new: 0.1 }), keys)), "JevError");

  // doctest:L44
  await t.checkThrows(async () => (parseJevResponse(response({ garden: NaN, weekend: 0, new: 0 }), keys)), "JevError");

  // doctest:L47
  await t.checkThrows(async () => (parseJevResponse(response({ garden: 1.1, weekend: -0.1, new: 0 }), keys)), "JevError");

  // doctest:L50
  await t.checkThrows(async () => (parseJevResponse(response({ garden: 1, weekend: 0, new: 0 }, Infinity), keys)), "JevError");

  // doctest:L53
  await t.checkThrows(async () => (parseJevResponse(null, keys)), "JevError");

  // doctest:L56
  await t.checkThrows(async () => (parseJevResponse({ model: "test", answers: { destination: { type: "noul", confidence: 1, probabilities: { garden: 1, weekend: 0, new: 0 } } } }, keys)), "JevError");
});

// Oversized catalogs fail before any request. No candidates are silently removed.
void test("Oversized catalogs fail before any request.", async (t) => {
  // doctest:L63
  const bounded = createJevService({ apiKey: "unused-test-key" });
  await t.checkThrows(async () => (await bounded.decide({ state: { candidates: "x".repeat(80_001) }, criteria: { existing: "Continue", new: "New" } })), "JevError");
});

// ## Whole-request budgeting preserves candidates with escaped captured text
//
// The budget includes the captured message, criterion descriptions, fixed prompt,
// and JSON escaping. Large catalogs shorten transcript evidence instead of losing
// destinations. These fixtures use the route's criterion descriptions and a
// maximum-length captured message containing backslashes and newlines.
void test("The budget includes the captured message, criterion descriptions, fixed promp...", async (t) => {
  // doctest:L76
  const escapedMessage = "garden\\\n".repeat(1500);
  function budgetedRequest(count: number) {
    const candidates: RoutingCandidate[] = Array.from({ length: count }, (_, index) => ({
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
  t.check(
    largeRequests.map(result => ({
      fits: result.request.length <= 80000,
      count: result.bounded.length,
      identitiesPreserved: result.bounded.every((candidate, index) => candidate.id === result.candidates[index]?.id && sessionIdOf(candidate) === sessionIdOf(result.candidates[index])),
      shortened: result.bounded.every(candidate => candidate.contextTruncated && candidate.recentContext !== undefined && candidate.recentContext.length < 2000),
    })),
    [
    {
      fits: true,
      count: 120,
      identitiesPreserved: true,
      shortened: true,
    },
    {
      fits: true,
      count: 200,
      identitiesPreserved: true,
      shortened: true,
    },
  ],
  );

  // doctest:L98
  await t.checkThrows(async () => (boundRoutingContexts([{ id: "c0", label: "Metadata that cannot fit", target: { kind: "new-session", contextDir: "" } }], 20)), "RoutingCatalogError: Chat routing rules and destination details exceed the request budget. Shorten the rubric, or copy your text into a chat using Chats.");
});

// ## Judgments: Noul, Choice, and Score questions in one call
//
// `judge` sends several named questions over one state. Each question's
// instructions are the situation, then the shared instructions, then its own;
// `criteria` keeps the wire shape of its type.
void test("judge sends several named questions over one state.", async (t) => {
  // doctest:L109
  const questions = {
    trip: { type: "noul", instructions: "Only school mail counts.", criteria: { true: "The school wrote about the field trip.", false: "It did not." } },
    kind: { type: "choice", instructions: ["Pick the sender type."], criteria: { school: "The school", shop: "A shop" } },
    urgency: { type: "score", instructions: "How soon must the boxholder act?", criteria: ["No action", "This month", "This week"] },
  } satisfies Record<string, JudgeQuestion>;
  const request = JSON.parse(serializeJudgeRequest({
    situation: "This box belongs to a family of four.",
    instructions: "Judge only what the emails say.",
    questions,
    state: "=== _content/inbox/a.email.card\nPermission slip due Friday",
  }));
  t.check(request.questions.trip, {
    type: "noul",
    instructions: [
      "This box belongs to a family of four.",
      "Judge only what the emails say.",
      "Only school mail counts.",
    ],
    criteria: {
      true: "The school wrote about the field trip.",
      false: "It did not.",
    },
  });

  // doctest:L123
  t.check(request.questions.kind, {
    type: "choice",
    instructions: [
      "This box belongs to a family of four.",
      "Judge only what the emails say.",
      "Pick the sender type.",
    ],
    criteria: {
      school: "The school",
      shop: "A shop",
    },
  });

  // doctest:L126
  t.check(request.questions.urgency.criteria, [
    "No action",
    "This month",
    "This week",
  ]);

  // A response is parsed per question into typed answers. A missing question, an
  // extra one, an option that was not offered, or a distribution that does not sum
  // to one is a `JevError`, never a partial answer.

  // doctest:L135
  const good = {
    model: "typesafe/jev-1.13",
    answers: {
      trip: { type: "noul", noul: 0.91 },
      kind: { type: "choice", choice: "school", confidence: 0.8, probabilities: { school: 0.9, shop: 0.1 } },
      urgency: { type: "score", score: 2, confidence: 0.6, probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 }, legend: {} },
    },
  };
  t.check(parseJudgeResponse(good, questions).answers, {
    trip: {
      type: "noul",
      probability: 0.91,
    },
    kind: {
      type: "choice",
      choice: "school",
      confidence: 0.8,
      probabilities: {
        school: 0.9,
        shop: 0.1,
      },
    },
    urgency: {
      type: "score",
      score: 2,
      confidence: 0.6,
      probabilities: {
        "0": 0.1,
        "1": 0.2,
        "2": 0.7,
      },
    },
  });

  // doctest:L146
  await t.checkThrows(async () => (parseJudgeResponse({ ...good, answers: { trip: good.answers.trip, kind: good.answers.kind } }, questions)), "JevError: Jev response error: answers did not match the 3 requested questions");

  // doctest:L149
  await t.checkThrows(async () => (parseJudgeResponse({ ...good, answers: { ...good.answers, trip: { type: "noul", noul: 1.2 } } }, questions)), "JevError: Jev response error: question \"trip\" has an invalid noul probability");

  // doctest:L152
  await t.checkThrows(async () => (parseJudgeResponse({ ...good, answers: { ...good.answers, kind: { ...good.answers.kind, choice: "bank" } } }, questions)), "JevError: Jev response error: question \"kind\" chose an option it was not offered");

  // doctest:L155
  await t.checkThrows(async () => (parseJudgeResponse({ ...good, answers: { ...good.answers, kind: { ...good.answers.kind, probabilities: { school: 0.5, shop: 0.2 } } } }, questions)), "JevError: Jev response error: question \"kind\" probabilities summed to 0.7");

  // doctest:L158
  await t.checkThrows(async () => (parseJudgeResponse({ ...good, answers: { ...good.answers, urgency: { ...good.answers.urgency, probabilities: { "0": 0.5, "1": 0.5 } } } }, questions)), "JevError: Jev response error: question \"urgency\" distribution keys did not match its 3 options");

  // doctest:L161
  await t.checkThrows(async () => (parseJudgeResponse({ ...good, answers: { ...good.answers, trip: { type: "choice", choice: "school" } } }, questions)), "JevError: Jev response error: question \"trip\" answer is missing or not a noul");
});
