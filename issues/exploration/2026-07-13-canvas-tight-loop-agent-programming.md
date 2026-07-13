---
title: "Canvas tight-loop: browser-less run→render→screenshot programming surface for agents"
needs: [design]
area: callback-box
---

Idea (Ian, 2026-07-13): instead of the browser-automation stack (`bin/browse`,
agent-browser, Chrome MCP) as the agent's way of *seeing* what a program does,
give the agent a much tighter surface: it writes a program with narrow access to
the world that renders onto a **canvas — no browser involved** — at a resolution
the agent chooses. The runtime can serialize that canvas to screenshots cheaply,
so the see-what-happened loop is one fast round trip instead of
navigate/wait/snapshot/screenshot/read-console across a live Chrome.

The output would be a single interleaved transcript: console/log lines with
frames inline at the points they occurred, so text and visuals are causally
joined instead of correlated by hand across separate tool calls.

One sketch was "every `console.log` triggers a screenshot immediately before the
log is emitted" — Ian flagged himself that this is racy. Likely resolution: make
the runtime deterministic instead of making capture atomic. Single-threaded
program, frame-based rendering (rAF-style), capture at frame boundaries, tag
every log line with the frame number it happened during; plus an explicit
`snapshot(label)` call for intentional captures. Frame numbers give the
ordering without racing. Dedupe unchanged frames so a 60fps run doesn't emit 60
identical images.

Second half of the idea: **symmetric events**. Whenever the program registers an
event handler, the runtime exposes an equally obvious way to *fire* those events
in a chosen order — so an agent can script an input sequence
(`pointerdown → drag → keypress → snapshot`) as a test run. Injected events go
through the same dispatch path as real input, so a script is simultaneously a
test, a reproduction, and a demo. Combined with deterministic time (virtual
clock, `advance(16)` stepping) and seeded RNG, runs become exactly reproducible
— which the browser stack fundamentally can't offer.

Why this fits agent cognition (assessment from the agent side, same date):

- The current browse loop costs several round trips per observation and joins
  logs↔pixels by timestamp guesswork; interleaved frame-tagged transcripts
  collapse that to one call.
- Agent-chosen resolution matters a lot: small canvases (~400×300) are cheap in
  image tokens; full-app screenshots are mostly wasted pixels. Being able to
  request a crop/zoom of a region is the visual analog of `--selector`.
- Determinism is the big win over `bin/browse`: no flake, no waits, goldens are
  possible (cf. [agent-browser-screenshot-flake](../bugs/2026-07-10-agent-browser-screenshot-flake.md)).
- Honest scope limit: this covers canvas-drawn programs (p5.js/Processing-style
  creative coding, sims, visualizations) — a new programming surface for boxes.
  It does not replace browse for the real DOM/CSS app UI. Related tension about
  which "look at output" tools earn their keep:
  [cb-render-vs-bin-browse](../decisions/2026-07-07-cb-render-vs-bin-browse.md).

Prior art to lean on: p5.js has a headless-friendly instance mode; `skia-canvas`
/ `node-canvas` give a real Canvas2D (and skia-canvas some WebGL) in Node with
no browser; frame-stepped virtual clocks are standard in game-engine testing.

## Research (incomplete)
