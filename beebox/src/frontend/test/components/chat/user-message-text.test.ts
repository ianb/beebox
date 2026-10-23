// # User message display: `<unsure>` word marks
//
// `UserMessageText` (`components/chat/user-message-text.tsx`) renders a sent
// message's body, expanding the `<send-message>`/`<user-selection>` pills.
// Track 4 of `docs/plans/transcript-confidence.md` adds a third embedded tag:
// `<unsure>word</unsure>`, placed in the body by `markUnsureWords` (Track 3)
// around a word the transcriber had low acoustic confidence in. The raw tag
// must never reach the DOM — it renders as its inner word with a subtle dotted
// underline, no tooltip, no legend.
//
// `stripUserDisplayTags` (called first, inside `UserMessageText`) only strips
// the `<speech>`/`<typed>` *shell* tags and their attributes — including the
// `stt="deepgram"` provenance attribute — so this also covers that the
// attribute never leaks into the rendered bubble.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserMessageText } from "../../../src/components/chat/user-message-text.js";

globalThis.React = React;

function render(text: string): string {
  return renderToStaticMarkup(React.createElement(UserMessageText, { text }));
}

// ## A marked word renders with the dotted-underline span, tag never shown raw
void test("A marked word renders with the dotted-underline span, tag never shown raw", async (t) => {
  const out = render('<speech stt="deepgram" local-time="14:23">they\'re all <unsure>cloud</unsure> code in different ways</speech>');
  await t.checkText(out, "<span>they&#x27;re all </span><span class=\"bbx-chat-user-unsure underline decoration-dotted decoration-white/40 underline-offset-2\">cloud</span><span> code in different ways</span>");
});

// ## A multi-word span (Track 3's hysteresis/bridge rework) renders as ONE run
//
// `markUnsureWords` now wraps whole PHRASE SPANS, not single words — the
// regex's `[\S\s]*?` inner capture already handles arbitrary text (spaces,
// interior punctuation) between the tags, so a multi-word span renders as
// one styled `<span>` covering the whole phrase, not one per word.
void test("markUnsureWords now wraps whole PHRASE SPANS, not single words — the regex's...", async (t) => {
  const spanOut = render('<speech stt="deepgram">they said <unsure>the cloud, right</unsure> away</speech>');
  await t.checkText(spanOut, "<span>they said </span><span class=\"bbx-chat-user-unsure underline decoration-dotted decoration-white/40 underline-offset-2\">the cloud, right</span><span> away</span>");
});

// ## A send tag with more attributes still renders as the pill
//
// When live dictation heard a send command that the HQ text did not reproduce,
// the tag gains `heard="live"` (`speech-keywords.ts`). It is the same pill: the
// raw tag never shows in the message.
void test("When live dictation heard a send command that the HQ text did not reproduce,...", async (t) => {
  const liveOut = render('<speech stt="whisper-llm-mini">something more like that <send-message phrase="Send message." heard="live" /></speech>');
  await t.checkText(liveOut, "<span>something more like that </span><span class=\"bbx-chat-user-token inline-flex items-center gap-1 bg-black/15 rounded-full px-2 py-0.5 text-xs font-medium\"><svg class=\"w-3 h-3\" fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5\"></path></svg>Send message.</span>");
});

// ## No marks at all — message renders unchanged, no pill machinery kicks in
//
// A message with no `<unsure>`/`<send-message>`/`<user-selection>` tags takes
// the plain-text fast path (no wrapping `<span>` per word).
void test("A message with no <unsure>/<send-message>/<user-selection> tags takes the pla...", async (t) => {
  t.check(render('<speech local-time="14:23">found three items</speech>'), "found three items");
});

// ## Multiple marks in one message — each word wraps independently
void test("Multiple marks in one message — each word wraps independently", async (t) => {
  const multiOut = render("<speech stt=\"deepgram\">that one <unsure>not</unsure> that <unsure>one</unsure> thing</speech>");
  await t.checkText(multiOut, "<span>that one </span><span class=\"bbx-chat-user-unsure underline decoration-dotted decoration-white/40 underline-offset-2\">not</span><span> that </span><span class=\"bbx-chat-user-unsure underline decoration-dotted decoration-white/40 underline-offset-2\">one</span><span> thing</span>");
});

// ## A message with no `stt` attribute (no confidence data captured) is unaffected
//
// `stt` is absent whenever Deepgram confidence wasn't captured or applied
// (Voxtral, OpenAI realtime, iOS native dictation, HQ-replaced text) — the
// body then simply has no `<unsure>` marks to render, and the wrapper's other
// attributes still strip cleanly.
void test("stt is absent whenever Deepgram confidence wasn't captured or applied (Voxtra...", async (t) => {
  t.check(render('<speech diarized="1" local-time="14:23">speaker A and speaker B</speech>'), "speaker A and speaker B");
});

// ## A selection pill names its document like the rest of the app
//
// The tooltip reads the card's name (no `.card`, no type suffix); a ref to
// another file keeps its name as written, and a selection from the chat
// transcript says "chat".
void test("A selection pill names its document like the rest of the app", async (t) => {
  const pillTitle = (html: string): string | undefined => /title="([^"]*)"/.exec(html)?.[1];
  t.check(pillTitle(render('<user-selection ref="_content/people/Ana_Reyes.person.card" pos="p1">quoted</user-selection>')), "&quot;quoted&quot; — Ana Reyes — p1");
  t.check(pillTitle(render('<user-selection ref="notes/my_file.pdf" pos="p1">quoted</user-selection>')), "&quot;quoted&quot; — my_file.pdf — p1");
  t.check(pillTitle(render('<user-selection pos="p1">quoted</user-selection>')), "&quot;quoted&quot; — chat — p1");
});
