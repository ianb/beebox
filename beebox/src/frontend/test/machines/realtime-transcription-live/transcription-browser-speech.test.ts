// The on-device live text adapter: words become final once they hold still, a
// recognizer that ends on its own restarts without losing text, and fatal
// errors give up instead of restarting.

import { test } from "tap";
import { BrowserSpeechLink, STABLE_WORD_MS } from "../../../src/machines/realtime-transcription-live/transcription-browser-speech";
import type { SpeechRecognitionLike } from "../../../src/lib/audio/live-engine";

function rig() {
  const instances: FakeRecognizer[] = [];
  class FakeRecognizer implements SpeechRecognitionLike {
    lang = "";
    continuous = false;
    interimResults = false;
    processLocally = false;
    onresult: SpeechRecognitionLike["onresult"] = null;
    onerror: SpeechRecognitionLike["onerror"] = null;
    onend: SpeechRecognitionLike["onend"] = null;
    constructor() {
      instances.push(this);
    }
    start() {}
    stop() {}
    abort() {}
    say(parts: { text: string; isFinal: boolean }[]) {
      this.onresult?.({ results: parts.map((p) => Object.assign([{ transcript: p.text }], { isFinal: p.isFinal })) });
    }
  }
  const clock = { now: 0 };
  const updates: { finalText: string; interimText: string }[] = [];
  const errors: string[] = [];
  const link = new BrowserSpeechLink({
    ctor: FakeRecognizer,
    lang: "en-US",
    listen: () => {},
    now: () => clock.now,
    callbacks: {
      onTextUpdate: ({ finalText, interimText }) => updates.push({ finalText, interimText }),
      onDone: () => {},
      onServerError: (message) => errors.push(message),
    },
  });
  link.start();
  return { instances, clock, updates, errors, link };
}

void test("words that hold still become final, so a keyword after a sentence can fire", (t) => {
  const { instances, clock, updates, link } = rig();
  t.teardown(() => link.detach());
  instances[0]?.say([{ text: "add milk", isFinal: false }]);
  clock.now += STABLE_WORD_MS;
  instances[0]?.say([{ text: "add milk send message", isFinal: false }]);
  t.check(updates.at(-1), { finalText: "add milk", interimText: "send message" });
  clock.now += STABLE_WORD_MS;
  instances[0]?.say([{ text: "add milk send message", isFinal: false }]);
  t.check(updates.at(-1), { finalText: "add milk send message", interimText: "" });
  t.end();
});

void test("a changed word restarts its clock; a re-cased word does not", (t) => {
  const { instances, clock, updates, link } = rig();
  t.teardown(() => link.detach());
  instances[0]?.say([{ text: "think through", isFinal: false }]);
  clock.now += STABLE_WORD_MS - 1;
  instances[0]?.say([{ text: "Think threw", isFinal: false }]);
  clock.now += 1;
  instances[0]?.say([{ text: "Think threw", isFinal: false }]);
  t.check(updates.at(-1), { finalText: "Think", interimText: "threw" });
  t.end();
});

void test("a recognizer that ends by itself restarts and keeps its text, final and interim", (t) => {
  const { instances, updates, link } = rig();
  t.teardown(() => link.detach());
  instances[0]?.say([{ text: "first part", isFinal: true }, { text: "second", isFinal: false }]);
  instances[0]?.onend?.();
  t.check(instances.map((r) => r.lang), ["en-US", "en-US"]);
  instances[1]?.say([{ text: "third", isFinal: true }]);
  t.check(updates.at(-1), { finalText: "first part second third", interimText: "" });
  t.end();
});

void test("a fatal error gives up once; other errors just restart", (t) => {
  const { instances, clock, errors, link } = rig();
  t.teardown(() => link.detach());
  instances[0]?.onerror?.({ error: "no-speech", message: "" });
  clock.now += 5000;
  instances[0]?.onend?.();
  t.check(instances.map((r) => r.lang), ["en-US", "en-US"]);
  t.check(errors, []);
  instances[1]?.onerror?.({ error: "not-allowed", message: "" });
  instances[1]?.onend?.();
  t.check(instances.map((r) => r.lang), ["en-US", "en-US"]);
  t.check(errors, ["Browser speech failed: not-allowed"]);
  t.end();
});

void test("a fatal error settles the tail once, so a later finish adds nothing", (t) => {
  const { instances, updates, link } = rig();
  instances[0]?.say([{ text: "hello world", isFinal: false }]);
  instances[0]?.onerror?.({ error: "audio-capture", message: "" });
  t.check(updates.at(-1), { finalText: "hello world", interimText: "" });
  const before = updates.length;
  link.finish();
  t.check(updates.slice(before), []);
  t.end();
});

void test("a recognizer that ends at once over and over gives up", (t) => {
  const { instances, errors, link } = rig();
  t.teardown(() => link.detach());
  for (let i = 0; i < 6; i++) instances.at(-1)?.onend?.();
  t.check(instances.map((r) => r.lang), ["en-US", "en-US", "en-US", "en-US", "en-US", "en-US"]);
  t.check(errors, ["The browser's speech recognizer keeps stopping"]);
  t.end();
});

void test("finish makes the tail final and stops restarting", (t) => {
  const { instances, updates, link } = rig();
  instances[0]?.say([{ text: "almost done", isFinal: false }]);
  link.finish();
  t.check(updates.at(-1), { finalText: "almost done", interimText: "" });
  t.check(instances.map((r) => r.lang), ["en-US"]);
  t.end();
});
