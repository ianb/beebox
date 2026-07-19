---
title: "Regenerable video capture of app interaction (demo/marketing, kept up to date)"
needs: [design]
filed-by: agent
discovered-in: main session — boxholder wants a shareable demo video an agent can keep current
area: callback-box
---

Produce a **shareable video of interacting with the app** — for demo/marketing —
that an agent can **regenerate on demand** so it stays current as the UI evolves.
The value is less "one hero video" and more "an always-up-to-date product demo the
system can re-render itself."

Most of the driving machinery already exists; the gap is *capture* + a *scripted
narrative* + a *determinism decision*.

### What already exists (driving the app is solved)

- **Tours** (`callback-box/test/tours/*.tour.ts`, framework `test/tours/tour-lib/`,
  run via `bin/tour`) already script walks through the running app —
  navigate/click/type — but today emit **screenshots** (desktop 1280×800 + mobile
  375×800) + a11y snapshots, not video (`docs/tours.md`). The interaction-scripting
  layer is the template a demo walk would reuse.
- **agent-browser** drives Chrome over CDP and exposes `get cdp-url` / `--cdp`, so a
  capture client can attach to the same session.
- **Determinism pieces** for a *repeatable* capture: `src/scenario/`
  (loader/runner for scripted multi-step fixtures), `CB_TIME` frozen time
  (`src/lib/time.ts`), and the fake-agent — so the demo can repeat rather than be a
  different live-LLM take each run.
- **The demo box is test1** (boxholder: "test1 is basically a shareable demo box").
  No purpose-built seeded box needed — but test1 is a manual playground (~40 demo
  threads, schedules disabled); a demo walk wants a curated *path through* it, and
  the content must stay presentable + free of anything not meant to be public.

### The three gaps

1. **Video capture** — no turnkey command (tours screenshot; agent-browser has
   `trace`/`har` but no screencast). Two clean paths:
   - attach a CDP client to agent-browser's `cdp-url`, run `Page.startScreencast`
     → JPEG frames → `ffmpeg` → mp4; **or**
   - run the walk under Playwright with `recordVideo` on (auto-webm), a parallel
     path to tour-lib.
   One-time build either way.
2. **The demo narrative** — a `*.tour.ts`-style script defining the story beats
   (dashboard → capture a memo → chat → a card/view → a schedule). Authoring +
   curation against test1.
3. **Determinism decision** (the crux for "keep it up to date") — the app's soul is
   agent interaction, which is non-deterministic. Either:
   - **scripted responses** (scenario/fake-agent + `CB_TIME`) → repeats identically,
     regenerates unattended, but shows canned answers; or
   - **live agent** → authentic but varies per run, needs a human "pick the good
     take." Auto-regeneration favors scripted; a hero cut may favor live.

### Two tiers (different economics)

- **(A) Always-current product-demo capture** — seeded/curated test1 path + scripted
  walk + screencast→mp4, re-runnable on demand or in CI. This is the part an agent
  can **build, own, and keep up to date**; most of the effort is the walk + the
  determinism setup, not the capture. This is the sweet spot the boxholder wants.
- **(B) Polished marketing/hero video** — (A) plus captions, cursor/zoom emphasis,
  pacing, voiceover, music, intro/outro. The raw footage regenerates automatically;
  the *gloss* does **not** self-update without a defined motion-graphics template
  (its own build). So "kept up to date" applies cleanly to (A), only partially to a
  fully-produced cut.

### Design questions to settle

- Capture mechanism: CDP-screencast-via-agent-browser vs Playwright `recordVideo`
  (does the walk stay in tour-lib, or fork to a Playwright script?).
- Determinism: scripted (scenario/fake-agent) vs live-with-human-pick — decides
  whether regeneration is truly unattended.
- Where the artifact lives + how it's shared (tours' artifacts are gitignored; a
  published demo mp4 needs a real home + a size budget).
- Personal-content guarantee: the walk must only ever touch demo content (test1),
  never a real box — a hard guard, given the app renders whatever box is running.
- Cadence/trigger: on-demand, on UI-affecting merges, or scheduled.
- How far to take Tier B here vs. deferring the polish to a separate item.

Related surfaces: `docs/tours.md`, `test/tours/tour-lib/`, `bin/tour`,
`src/scenario/`, `src/lib/time.ts`, agent-browser (`get cdp-url`). A concrete build
probably wants a short plan (`docs/plans/`) before implementation given the
multi-part shape.
