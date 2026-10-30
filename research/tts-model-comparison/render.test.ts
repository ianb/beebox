import assert from "node:assert/strict";
import { test } from "node:test";
import { type Clip, loadResults, NO_CHANNEL } from "./lib.ts";
import { adapterFor, type Built, jobs } from "./render.ts";

const results = loadResults();

function clip(code: string): Clip {
  const found = results.clips.find((c) => c.code === code);
  assert.ok(found, `clip ${code}`);
  return found;
}

function built(model: string, code: string, variant: string): Built {
  const c = clip(code);
  const v = c.variants.find((x) => x.id === variant);
  assert.ok(v, `variant ${variant}`);
  const out = adapterFor(model).request(v, c);
  assert.ok(out, `${model} has a request for ${code}-${variant}`);
  return out;
}

/** The provider options of an OpenRouter body. */
function providerOptions(body: Record<string, unknown>): unknown {
  const provider = body["provider"];
  return typeof provider === "object" && provider !== null && "options" in provider ? provider.options : undefined;
}

test("every model in results.json has an adapter, and every take has a row", () => {
  for (const model of results.models) {
    const planned = jobs(adapterFor(model.id), results.clips);
    assert.equal(planned.length, results.clips.reduce((n, c) => n + c.variants.length, 0), model.id);
  }
});

test("OpenAI carries prose in its instructions field and leaves the text alone", () => {
  const b = built("gpt-4o-mini-tts-2025-12-15", "R", "directed");
  assert.equal(b.body["instructions"], clip("R").variants[1]?.direction?.prose);
  assert.equal(b.body["input"], clip("R").text);
  assert.equal(b.channel, "instructions field");
  const box = built("gpt-4o-mini-tts-2025-03-20", "S", "plain");
  assert.equal(box.body["instructions"], "", "a plain take through the box service sends no direction, not the box default");
});

test("Gemini 3.8 carries prose in a speech_metadata annotation", () => {
  const b = built("gemini-3.8-flash-tts-direct", "X", "she");
  assert.match(JSON.stringify(b.body), /"annotations":\[{"type":"speech_metadata","style":"Stress the word 'she'/);
  assert.match(JSON.stringify(b.body), /"text":"I didn't say she stole the money\."/);
  assert.equal(b.body["store"], false);
});

test("Gemini 3.1 gets the prose in front of the tagged text, on both routes", () => {
  const direct = built("gemini-3.1-flash-tts-preview-direct", "A", "directed");
  assert.match(JSON.stringify(direct.body), /"text":"Barely contained fury: quiet, clipped, every word deliberate\. Do not shout: \\"\[quietly furious\] I asked/);
  assert.doesNotMatch(JSON.stringify(direct.body), /speech_metadata/);
  const routed = built("gemini-3.1-flash-tts", "X", "money");
  assert.equal(routed.body["input"], "Stress the word 'money'; it carries the meaning of the sentence: \"I didn't say she stole the money.\"");
  assert.equal(routed.channel, "prose prefix");
});

test("Cartesia carries a fixed emotion in generation_config", () => {
  const b = built("sonic-3.6", "A", "directed");
  assert.deepEqual(b.body["generation_config"], { emotion: "angry", speed: 0.85, volume: 0.8 });
  assert.equal(b.body["transcript"], clip("A").text);
});

test("MAI and MiniMax carry their value in OpenRouter's provider options", () => {
  assert.deepEqual(providerOptions(built("mai-voice-2", "A", "directed").body), { azure: { style: "angry", styledegree: 1.5 } });
  assert.deepEqual(providerOptions(built("minimax-2.8-turbo", "W", "directed").body), { minimax: { emotion: "calm" } });
});

test("ElevenLabs v3, Fish, Grok and Voxtral carry direction as tags in the text", () => {
  assert.match(String(built("eleven_v3", "S", "directed").body["text"]), /^\[sarcastically\] Thanks/);
  const fish = built("fish-s2.1-pro", "C", "directed").body;
  assert.match(String(fish["input"]), /\[in Spanish\] "son las once,"/);
  assert.deepEqual(providerOptions(fish), { "fish-audio": { normalize: false } });
  assert.match(String(built("grok-voice-tts", "R", "directed").body["input"]), /^\[sigh\] <slow>Sure/);
  assert.match(String(built("voxtral-mini-tts-3", "W", "directed").body["input"]), /^\[emotion=calm\]Water boils/);
});

test("a model with no channel reads text variants unchanged and records no request for directed ones", () => {
  const b = built("flux-hannah-en", "X", "she-italic");
  assert.deepEqual(b.body, { text: "I didn't say *she* stole the money." });
  assert.equal(b.channel, "none");
  const planned = jobs(adapterFor("eleven_flash_v2_5"), results.clips);
  const directed = planned.filter((j) => j.variant.direction !== undefined);
  assert.ok(directed.length > 0);
  for (const j of directed) assert.equal(j.built, undefined, `${j.clip.code}-${j.variant.id}`);
  assert.equal(NO_CHANNEL, "none available");
});
