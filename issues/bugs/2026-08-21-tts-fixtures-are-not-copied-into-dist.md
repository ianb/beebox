---
title: "The mock TTS fixtures never reach dist, so /dev/speech fails on any built server"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — checking the speech-playback user stories on /dev/speech
priority: important
---

Every segment on the `/dev/speech` harness goes to state `failed` with
`TTS API error 500 {"error":"mock TTS fixture missing — run: pnpm tsx
scripts/gen-tts-fixtures.ts"}`.

Running that script does not help. The fixtures are committed at
`callback-box/src/webapp/test-fixtures/tts/{seg0,seg1,seg2}.mp3`. The mock
resolves them relative to its own emitted module:

```ts
const FIXTURE_DIR = join(import.meta.dirname, "test-fixtures", "tts");
```

(`callback-box/src/webapp/tts-mock.ts:21`.) The box server runs the bundled build
(`callback-box/dist/cli.mjs`), so that resolves to
`callback-box/dist/test-fixtures/tts`, and the build is `tsc`
(`callback-box/package.json`), which copies no `.mp3`. The directory never
exists on a dist-run server, which is every worktree box server.

Consequence: the harness that exists to check streaming playback, stop and
fast-forward cannot play anything.

Worked around locally by copying the three files into the gitignored
`callback-box/dist/test-fixtures/tts/`; a clean build removes it again.
