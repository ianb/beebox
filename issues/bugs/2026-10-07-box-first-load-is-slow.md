---
title: "The first load of a box page waits on a 2.3 MB entry script and a cold box server"
workstream: box-first-load
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: worktree-box-first-load — first-load measurement pass
---

The first page load of a box is slow. Most of the time goes to two
costs: the browser loads one 2.3 MB entry script, and a lazy hub
starts the box server before it sends any HTML.

## Measurements (2026-10-07, before changes)

Setup: a local `bbx engine hub` (lazy) on the built `dist/` bundle with a
`test1` clone. A gzip proxy is in front, because production sits behind
Cloudflare, which compresses JS and CSS at the edge. The CDP measurement
loads the page in a fresh browser context, which has no HTTP cache.
"Composer" is the time until the chat textarea is visible and enabled.

| Case | HTML TTFB | React mounted | Composer |
| --- | --- | --- | --- |
| Box warm, 4G (9 Mbps, 60 ms RTT) | 4 ms | 943 ms | 1028 ms |
| Box warm, 4G, 4× CPU slowdown | 3 ms | 1200 ms | 1383 ms |
| Box warm, slow 4G (1.6 Mbps, 150 ms), 4× CPU | 4 ms | 4524 ms | 4815 ms |
| Box cold (stopped), 4G, 4× CPU | 640 ms | 1800 ms | 2000 ms |
| Repeat visit (HTTP cache warm), 4G, 4× CPU | 4 ms | 175 ms | 292 ms |

Contributors:

- **Entry script.** `assets/index-*.js` is 2.39 MB raw, 735 KB gzip.
  Every card renderer (admin, settings, history, inventory, dashboard,
  PDF, docling and others) is imported statically through
  `src/frontend/src/renderers.ts`. Those renderers alone are 606 KB raw /
  190 KB gzip of the entry. The default route is chat, which needs none of
  them.
- **Serial requests before React renders.** `main/app.tsx` awaits a dynamic
  import of `file-types/builtins.tsx`, a 2.5 KB chunk, before it renders. The
  shell then waits for `GET /api/boxes` (`BoxValidationLayout`) before it
  mounts. Each costs one round trip after the entry script executes.
- **Cold box server.** A stopped box answers its first HTML request after
  about 640 ms. `bbx engine serve` takes about 560 ms from spawn to listen.
  About 490 ms of that is loading `dist/cli.mjs`, and
  `--enable-source-maps` adds about 100 ms of it. The hub then polls
  readiness every 150 ms (`src/hub/child-process-utils.ts`), which adds
  0–150 ms.
- **tRPC.** The initial queries are fast on a warm box (all < 70 ms except
  `voice.capabilities` at about 300 ms). They are not on the composer's
  critical path.

The dev router (Vite) numbers are a different shape and are not used here.

## Production check (2026-10-07)

- The edge compresses and caches `/assets/*`: the entry script arrives as
  723–750 KB (zstd, brotli, or gzip by `Accept-Encoding`) with
  `cf-cache-status: HIT` after the first fetch. The local edge stand-in
  (`beebox/src/dev/perf/hub/edge-proxy.ts`) models this.
- `pnpm perf:load --target prod` against one production box, 4G with 4× CPU
  slowdown, from the developer's machine: HTML TTFB 220 ms, React mounted
  1416 ms, composer 1706 ms, history response complete about 2830 ms. The
  local model gives composer 1347 ms; the difference is real network latency
  on each round trip.
- In production, the history request starts late. The chain is: first batch
  (ends 2250 ms) → `chat.directoryFor` → a second batch →
  `chat.status,chat.history` (2707–2831 ms). It ends about 1.1 s after the
  composer appears.
- A lazy production box that has been idle longer than the hub's idle timeout
  pays the cold start on its first load. Locally that cold start is about
  790 ms before the HTML arrives: `bbx serve` takes about 520 ms to load
  `dist/cli.mjs`. Of that, about 100 ms is `--enable-source-maps` reading and
  indexing the 11 MB source map.
- Each fresh page load calls `chat.reserveSession`, which warms a Claude
  subprocess on the server during the load.

Measurement tooling and procedure: `beebox/docs/development/performance.md`.
