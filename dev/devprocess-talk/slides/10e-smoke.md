# Three escapes in two days
## Supporting: the smoke tier's origin, 1e8cfe8c4
```text
Three escapes on 2026-08-25/26 passed typecheck, lint and their selected
tests while the app was broken: the code was right and the state was wrong.
Only a real box on the real machine shows that.

bin/smoke restarts this checkout's dev-server generation through the router's
trusted control socket, waits for the box to serve, then walks it… ~30s, no
model turns, hard 120s budget.

The restart is the point, not setup. The router runs TypeScript off disk and
never reloads it, so without it the walk tests whatever source happened to be
on disk when the generation started.
```

```text
restart        restart the dev-server generation
cold-start     the box's backend answers after a cold start
chat-shell     the chat page renders its shell
place-menu     the place menu opens and lists landmarks
browse-list    browse lists the box's real content
card-open      a card opens and renders
page-errors    the walk raised no uncaught page errors
```

- 517 runs since; 416 green, 101 red; median 59 seconds; a cross-model review closed two false greens the same day

Notes:
The three escapes: a missing frontend build, broken global Codex state, an SDK item outside its own union. A weekly review now asks whether each step still earns its place; it found that scheduled landings skip the walk entirely (open issue, three windows of evidence).
