// # channelsToTry: loudness by presence
//
// `channelsToTry` decides, for one intent, which channels to send on and which
// to log as skipped. It is pure: the caller supplies who each channel can reach
// (the audience) and how many web sessions have a person active (presence).

import { test } from "tap";
import "agent-doctest/tap";
import { channelsToTry } from "../../../src/core/notification/channels.js";
import type { Audience } from "../../../src/core/notification/channels.js";
import type { Loudness } from "../../../src/core/notification/intent.js";

const ALL: Audience = { apns: true, "web-push": true };
const NONE: Audience = { apns: false, "web-push": false };
// The audience a box can have before any phone pairs: no APNs, a subscribed browser.
const NO_APNS: Audience = { apns: false, "web-push": true };

function row({ loudness, audience, activeWeb }: { loudness: Loudness; audience: Audience; activeWeb: number }) {
  const plan = channelsToTry({ intent: { loudness }, audience, presence: { activeWeb } });
  const skipped = plan.skipped.map((d) => `${d.channel}:${d.detail}`).join(" ");
  return `${loudness.padEnd(5)} present=${activeWeb}  try [${plan.channels.join(" ")}]  skip [${skipped}]`;
}

const LOUDNESSES: Loudness[] = ["loud", "quiet", "dot"];
function matrix(audience: Audience) {
  return LOUDNESSES.flatMap((loudness) => [0, 1].map((activeWeb) => row({ loudness, audience, activeWeb }))).join("\n");
}

// ## Every channel reachable
//
// `loud` goes everywhere whatever the presence. `quiet` goes everywhere only
// when nobody is present; an open app shows it instead. `dot` is a badge, so
// only `apns` is a candidate, and presence never suppresses it.
void test("loud goes everywhere whatever the presence.", async (t) => {
  // doctest:L36
  await t.checkText(matrix(ALL), `loud  present=0  try [apns web-push]  skip []
loud  present=1  try [apns web-push]  skip []
quiet present=0  try [apns web-push]  skip []
quiet present=1  try []  skip [apns:present web-push:present]
dot   present=0  try [apns]  skip []
dot   present=1  try [apns]  skip []`);
});

// ## No APNs audience (today's boxes)
//
// A channel with nobody to reach is a `no-audience` skip. For a `dot` that is
// the only line, since `apns` is its only candidate.
void test("A channel with nobody to reach is a no-audience skip.", async (t) => {
  // doctest:L52
  await t.checkText(matrix(NO_APNS), `loud  present=0  try [web-push]  skip [apns:no-audience]
loud  present=1  try [web-push]  skip [apns:no-audience]
quiet present=0  try [web-push]  skip [apns:no-audience]
quiet present=1  try []  skip [apns:present web-push:present]
dot   present=0  try []  skip [apns:no-audience]
dot   present=1  try []  skip [apns:no-audience]`);
});

// ## Nobody reachable
//
// With no audience and nobody present, nothing is tried and every candidate
// is `no-audience`. The notification health check reports that outcome. A
// present person turns a `quiet` into `present` skips: the open app showed it.
void test("With no audience and nobody present, nothing is tried and every candidate is...", async (t) => {
  // doctest:L69
  await t.checkText(matrix(NONE), `loud  present=0  try []  skip [apns:no-audience web-push:no-audience]
loud  present=1  try []  skip [apns:no-audience web-push:no-audience]
quiet present=0  try []  skip [apns:no-audience web-push:no-audience]
quiet present=1  try []  skip [apns:present web-push:present]
dot   present=0  try []  skip [apns:no-audience]
dot   present=1  try []  skip [apns:no-audience]`);
});

// ## The target is on screen
//
// A caller that knows its target is on screen right now (a chat callout while a
// web session is present) passes `onScreen`: a `quiet` or `loud` intent is
// `present` on every channel, and a `dot` still badges the phone.
void test("A caller that knows its target is on screen right now (a chat callout while a...", async (t) => {
  // doctest:L86
  function onScreenRow(loudness: Loudness) {
    const plan = channelsToTry({ intent: { loudness }, audience: ALL, presence: { activeWeb: 1 }, onScreen: true });
    return `${loudness.padEnd(5)} try [${plan.channels.join(" ")}]  skip [${plan.skipped.map((d) => `${d.channel}:${d.detail}`).join(" ")}]`;
  }

  // doctest:L91
  await t.checkText(LOUDNESSES.map(onScreenRow).join("\n"), `loud  try []  skip [apns:present web-push:present]
quiet try []  skip [apns:present web-push:present]
dot   try [apns]  skip []`);
});
