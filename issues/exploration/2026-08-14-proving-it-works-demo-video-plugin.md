---
title: "Check out `proving-it-works` — a Claude Code plugin that records and verifies demo videos"
workstream: unattached
area: callback-box
labels: [tooling-eval, demo-video]
filed-by: agent
discovered-by: Ian
discovered-in: main session — link passed along for evaluation
priority: backlog
---

[proving-it-works](https://github.com/prime-radiant-inc/proving-it-works) (Prime
Radiant Inc., MIT) is a Claude Code plugin that has an agent record a narrated
demonstration video of software working, then mechanically verifies the video
before it is shared. Seen via
[a Threads post](https://www.threads.com/share/BAPeEGXrWW/).

Worth a look for two separate reasons, and they are worth keeping apart.

## 1. It overlaps our demo-video item directly

[regenerable-app-demo-video](../features/2026-07-17-regenerable-app-demo-video.md)
names three gaps: video capture, a scripted narrative, and a determinism
decision. This tool has opinions about the first two — four recording routes
(browser interaction, terminal session, still sequence, log-rendered reel),
subtitles, narration gating, cursor visibility, and measured pacing. Our
capture gap was scoped as a one-time build either way (CDP screencast or
Playwright `recordVideo`), so the question is not whether we *can* build it but
whether adopting this skips the narrative/pacing work we had not scoped at all.

Read it against what we already have rather than as a drop-in: our walk layer
is `test/tours/` driven by `bin/tour`, and the determinism question
(scenario/fake-agent vs live agent) is ours to answer regardless of who records
the frames.

## 2. The verification idea may matter more than the recording

The interesting part is `check-movie`: it samples the audio and video timelines
*together* to catch a class of defect per-frame checking misses — a frozen
picture while narration keeps talking, desynced audio, silence. The project says
it exists because per-frame verification passed on a video that was actually
frozen. It emits a contact sheet for human review rather than asserting the
video is good.

That is a real epistemic point and it generalizes past video. It is the same
shape as several tensions we already carry: a check that passes because it was
measuring the wrong axis, and a checker that should report *inconclusive*
instead of a verdict — compare
[health masks a review-step turn cap](../bugs/2026-08-12-health-masks-review-step-turn-cap.md).
Even if we never record a video, the "verify along the axis the failure actually
lives on, then hand a human something to look at" pattern is worth stealing.

## What to actually do

- Read the skill and `check-movie`; judge whether the recording routes fit
  `bin/tour` or fight it.
- Note the dependencies before adopting: `ffmpeg`, `ffprobe`, `uv`. `uv` is
  already on the server (its CUDA cache is a known disk consumer), but a new
  runtime dependency for the demo path is a cost worth stating.
- Decide adopt / borrow-the-verification-idea / neither, and record which in
  the demo-video issue.

Hard constraint carried over from that issue: any capture walk must only ever
touch demo content, never a real box.
