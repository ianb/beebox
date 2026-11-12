// # Tour beats
//
// `src/shared/tour-beats.ts`: a tour card's body splits at `## ` headings.
// Text before the first heading is the introduction. A `## ` line inside a
// fenced code block is content.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { currentBeatIndex, parseTourBeats } from "../../src/shared/tour-beats.js";

void test("introduction and beats split at ## headings", async (t) => {
  t.check(parseTourBeats("Welcome.\n\n## Look around\nOpen [Home](/_content/Home.doc.card).\n\n## Ask me\nType a question.\n"), {
    introduction: "Welcome.",
    beats: [
      { title: "Look around", markdown: "Open [Home](/_content/Home.doc.card)." },
      { title: "Ask me", markdown: "Type a question." },
    ],
  });
});

void test("a ## line inside a fence is content, not a beat", async (t) => {
  t.check(parseTourBeats("## One\n```md\n## not a beat\n```\n## Two\n"), {
    introduction: "",
    beats: [
      { title: "One", markdown: "```md\n## not a beat\n```" },
      { title: "Two", markdown: "" },
    ],
  });
});

void test("no headings means no beats; empty and ### headings are not beats", async (t) => {
  t.check(parseTourBeats("Just text.\n### Sub\n##\n## \n"), {
    introduction: "Just text.\n### Sub\n##\n##",
    beats: [],
  });
});

void test("duplicate titles stay separate beats", async (t) => {
  t.check(parseTourBeats("## A\none\n## A\ntwo").beats, [
    { title: "A", markdown: "one" },
    { title: "A", markdown: "two" },
  ]);
});

void test("currentBeatIndex finds the titled beat or null", async (t) => {
  const beats = parseTourBeats("## A\n## B\n").beats;
  t.check([currentBeatIndex(beats, "B"), currentBeatIndex(beats, " A "), currentBeatIndex(beats, "C"), currentBeatIndex(beats, undefined)], [1, 0, null, null]);
});

// Markdown allows closing hashes on a heading. They are not part of the
// title, so `current: Arrival` names the beat written as `## Arrival ##`.
void test("closing hashes are not part of a beat title", async (t) => {
  const { beats } = parseTourBeats("## Arrival ##\nHello.\n## C# basics\n");
  t.check(beats.map((beat) => beat.title), ["Arrival", "C# basics"]);
  t.check(currentBeatIndex(beats, "Arrival"), 0);
});
