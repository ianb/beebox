// Gemini generateContent over REST: the request it sends, the response fields
// it keeps, and how failures surface. Never contacts a provider.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { z } from "zod";
import { GeminiHttpError, GeminiResponseShapeError, generateContent } from "../../src/services/gemini-rest.js";

const RequestInit = z.object({ contents: z.array(z.object({ role: z.string(), parts: z.array(z.unknown()) })), generationConfig: z.unknown().optional() });

function stubFetch(t: Test, respond: () => Response): { calls: Array<{ url: string; key: string | null; body: z.infer<typeof RequestInit> }> } {
  const previous = globalThis.fetch;
  t.teardown(() => { globalThis.fetch = previous; });
  const calls: Array<{ url: string; key: string | null; body: z.infer<typeof RequestInit> }> = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({ url: request.url, key: request.headers.get("x-goog-api-key"), body: RequestInit.parse(await request.json()) });
    return respond();
  };
  return { calls };
}

void test("a call posts one user turn with the key in a header and keeps only the fields callers read", async (t) => {
  const stub = stubFetch(t, () => Response.json({
    candidates: [{ content: { parts: [{ text: "hi" }, { inlineData: { mimeType: "image/png", data: "QUJD" } }] }, finishReason: "STOP", safetyRatings: [{ x: 1 }] }],
    usageMetadata: { promptTokenCount: 2, totalTokenCount: 3 },
    modelVersion: "ignored",
  }));
  const response = await generateContent({
    apiKey: "k1",
    model: "gemini-2.5-flash",
    parts: [{ text: "q" }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });
  t.check({ stub: stub.calls, response }, {
    stub: [{
      url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      key: "k1",
      body: { contents: [{ role: "user", parts: [{ text: "q" }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } },
    }],
    response: {
      candidates: [{ content: { parts: [{ text: "hi" }, { inlineData: { mimeType: "image/png", data: "QUJD" } }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 2, totalTokenCount: 3 },
    },
  });
});

void test("an empty candidate list parses, so callers decide what empty means", async (t) => {
  stubFetch(t, () => Response.json({ promptFeedback: { blockReason: "SAFETY" } }));
  t.check(await generateContent({ apiKey: "k", model: "m", parts: [] }), { promptFeedback: { blockReason: "SAFETY" } });
});

void test("a non-2xx answer is a GeminiHttpError with the status and the API's message, and is not retried", async (t) => {
  const stub = stubFetch(t, () => Response.json({ error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" } }, { status: 503 }));
  const error = await generateContent({ apiKey: "k", model: "m", parts: [] }).catch((e: unknown) => e);
  t.check({ is: error instanceof GeminiHttpError, calls: stub.calls.length, fields: error instanceof GeminiHttpError ? [error.status, error.apiMessage, error.message] : null }, {
    is: true,
    calls: 1,
    fields: [503, "The model is overloaded.", "Gemini API error 503: The model is overloaded."],
  });
});

void test("a non-JSON error body still reports the status", async (t) => {
  stubFetch(t, () => new Response("<html>bad gateway</html>", { status: 502 }));
  const error = await generateContent({ apiKey: "k", model: "m", parts: [] }).catch((e: unknown) => e);
  t.check(error instanceof GeminiHttpError ? [error.status, error.apiMessage, error.message] : null, [502, undefined, "Gemini API error 502"]);
});

void test("a 2xx body of the wrong shape is a GeminiResponseShapeError", async (t) => {
  stubFetch(t, () => Response.json({ candidates: "nope" }));
  const error = await generateContent({ apiKey: "k", model: "m", parts: [] }).catch((e: unknown) => e);
  t.check(error instanceof GeminiResponseShapeError ? error.name : null, "GeminiResponseShapeError");
});
