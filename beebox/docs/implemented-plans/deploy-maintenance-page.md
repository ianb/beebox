---
title: "Deploy maintenance page and deploy timing record"
status: implemented
workstream: deploy-maintenance-page
issues:
  - ../../../issues/closed/features/2026-09-18-deploy-maintenance-page.md
  - ../../../issues/closed/code-quality/2026-09-18-deploy-timing-record.md
  - ../../../issues/closed/bugs/2026-09-18-deploy-reads-ssh-failure-as-a-signal.md
---
# Deploy maintenance page and deploy timing record

When a production deploy restarts the services, the site answers every request
with nginx's bare 502 for about four minutes. A person cannot tell a restart
from an outage. This plan makes nginx serve a page that says an update is in
progress, when it started, and how long updates usually take. It also records
deploy timings so that estimate is real, and fixes the deploy's misreading of
ssh failures as signals so the recorded outcome is true.

**Issues addressed:**
[deploy maintenance page](../../../issues/closed/features/2026-09-18-deploy-maintenance-page.md),
[deploy timing record](../../../issues/closed/code-quality/2026-09-18-deploy-timing-record.md),
[ssh failure read as a signal](../../../issues/closed/bugs/2026-09-18-deploy-reads-ssh-failure-as-a-signal.md).
Searched the queue for `502`, `maintenance page`, `nginx`, `deploy timing`.
Related but not addressed:
[Cloudflare Flexible SSL](../../../issues/bugs/2026-08-07-cloudflare-flexible-ssl-origin-plaintext.md)
wants a TLS listener in the same nginx file; this plan makes that file
deploy-owned, which makes that fix deployable, but does not do it. The closed
[502 surfaces as a JSON parse error](../../../issues/closed/bugs/2026-09-09-deploy-restart-502-surfaces-as-json-parse-error.md)
fixed the client side of the same window.

## Smallest fix and budget

Smallest fix: a static HTML page, an `error_page 502` rule, and a marker file
written before `systemctl stop` and removed after the restart. That alone
answers "restart or outage?" but says nothing true about duration and can go
stale.

Chosen design, four tracks in one subproject (`beebox/deploy` plus one TS
module and one build script):

| Track | Source | Tests |
|---|---|---|
| A. nginx site file owned by the deploy | ~60 | ~80 (runs a real nginx) |
| B. Page + server-side window helper | ~200 | ~150 |
| C. Deploy wiring + laptop timing record + phase timestamps | ~120 | ~40 |
| D. Real-signal detection (ssh 255) | ~40 | ~40 |

Estimate ~730 changed lines, plus ~60 lines of reference docs. Not a BIG
CHANGE. What the fuller design buys over the smallest fix: an honest duration
(the boxholder's actual question), a page that cannot claim "updating" forever,
and an nginx file that reaches the live server at all.

## Stated preferences this plan trades against

- **Boxholder privacy constraint (2026-09-18):** the page is unauthenticated,
  so it carries the start time only. "I think a commit message is more public
  than we'd want on a 502 page. Maybe even ref..." The page shows the start
  time and the typical duration, which derives from timings only. No sha, ref,
  subject, branch, workstream, host name, or product name.
- **Engineering principle 4** (resilient and never silent) and
  **principle 13** (a control shows the state the system is in): the page must
  not claim an update when there is none. Absence of the page file is the
  "not a deploy" signal, and the page's wording degrades with elapsed time.
- **TypeScript over JavaScript (boxholder rule):** the page's client logic is a
  TS module, bundled by esbuild into the page at build time, not an inline
  hand-written script.
- **Precedent — systemd drop-ins** (`beebox/deploy/deploy.sh:755-793`): the
  deploy reinstalls repo-owned config on every run and reloads only on change.
  The nginx file follows that shape.
- **Consolidate over drift:** `setup-server.sh` installs the same repo file
  instead of carrying its own heredoc copy.

## What already exists

- **Activation runs on the server as one script.** Remote phases are queued
  into `.activate-deploy.sh` (`deploy.sh:490-507`: *"Collect the existing
  remote phases into one trusted script."*) and run under
  `node "$stage_dir/beebox/dist/cli.mjs" engine maintenance --verify-hub ... -- bash "$stage_dir/.activate-deploy.sh"`
  (`deploy.sh:987`). The stop is the first queued command (`:507`) and the
  health checks are the last (`:833-937`). Reuse: the marker and its cleanup
  trap live in this script, so a laptop-side failure cannot strand it.
- **nginx site file** is written only at provisioning
  (`deploy/hetzner/setup-server.sh:368-397`). `deploy/README.md:147-148`:
  *"This script does not run on deploy. `deploy.sh` never invokes it, so any
  change to the nginx config or systemd units here reaches a live server only on
  a re-provision."* Rebuild: move it into `deploy/nginx/beebox.conf`.
- **Server-side helper scripts** live in `deploy/server-bin/` (bash; e.g.
  `bbx-host-apt`, installed at `deploy.sh:728`). Reuse the location and style.
- **Server `deploy-history.json`** (`deploy.sh:691-710`) records what shipped,
  written mid-activation before the restart. It cannot record the end of the
  window or a failed outcome. Not reused; the window record is written from
  the trap. Reason: different lifetime (every outcome, including failures).
- **Client handling of gateway statuses:**
  `src/frontend/src/lib/trpc/transient.ts:29`
  `const GATEWAY_STATUSES = new Set([502, 503, 504]);` — a 503 during a deploy
  is retried like today's 502. The hub's own 503s (`src/hub/box-unavailable.ts:35`)
  are responses from the upstream, which nginx does not intercept (spike below).
- **Exit trap:** `deploy_exit` (`deploy.sh:66-98`) with the misread at `:80`
  `if [ "$rc" -ge 128 ]; then`.
- **Build scripts:** `scripts/build-cli.ts` (esbuild) and
  `scripts/build-box-docs.ts` run from the build checkout (`deploy.sh:385-399`);
  `dist/` is rsynced. The page template joins them.

## Prior art (external)

- nginx `error_page` to a named location, then `return 503` with
  `error_page 503` to an internal URI, needs `recursive_error_pages on` at
  server level. Verified by spike on nginx 1.31.6 (2026-09-18): with the marker,
  GET/POST/HEAD return 503 with the page and headers; without it, the default
  502; the upstream's own 503 passes through; the internal URI answers 404 when
  requested directly. Directive reference:
  https://nginx.org/en/docs/http/ngx_http_core_module.html#recursive_error_pages
- Error-page redirects to a non-named URI change the method to GET, which
  avoids the static module's 405 on POST. Same reference, `error_page`.
- Cloudflare passes origin 5xx bodies through; the boxholder saw nginx's own
  502 body tonight, which confirms passthrough for this zone. `Cache-Control:
  no-store` keeps the page out of any cache.

## Tracks / scope

### A. nginx site file owned by the deploy

- **What:** `beebox/deploy/nginx/beebox.conf` holds the full site file. Each
  deploy installs it and reloads nginx only when it changed.
- **Why:** the page needs an `error_page` rule on the live server, and the
  provisioning-only file never reaches it.
- **Direction:** the file is today's server block plus:
  `recursive_error_pages on;` at server level; `error_page 502 504 = @hub_unreachable;`
  in `location /`; `location @hub_unreachable` returns 503 when
  `/run/beebox-deploy/deploy-in-progress.html` exists, else 502;
  `location = /__bbx_deploy_in_progress.html` is `internal`, rooted at
  `/run/beebox-deploy`, with `Cache-Control: no-store`, `Retry-After: 30`, and
  `X-Beebox-Deploy: in-progress`. Install step (queued first in the activation
  script, before the marker and the stop): if the staged file differs from
  `/etc/nginx/sites-available/beebox`, keep a one-time copy at
  `beebox.pre-deploy-owned`, save the current one as `beebox.prev`, install,
  `nginx -t`; on failure restore `beebox.prev` and fail the deploy (the site is
  still up — nothing has stopped yet); on success `systemctl reload nginx`.
  `setup-server.sh` installs the same file from its clone.
- **Vocabulary lock-ins:** `/run/beebox-deploy/deploy-in-progress.html` (the
  marker is the page); response header `X-Beebox-Deploy`; internal URI
  `/__bbx_deploy_in_progress.html`.
- **First chunk:** the conf file, the install block, setup-server switch, and
  a doctest that runs a real nginx against it.

### B. The page and the server-side window helper

- **What:** a TS module renders the page template; a bash helper
  `deploy/server-bin/bbx-deploy-window` opens and closes the window.
- **Why:** the page must say something true about duration and must age out.
- **Direction:**
  - `src/deploy/deploy-page.ts` exports
    `deployPageText(startedMs: number, nowMs: number, typicalSeconds: number | null): { headline: string; detail: string }`
    and the browser entry that reads
    `<script type="application/json" id="bbx-deploy">{"startedMs":…,"typicalSeconds":…}</script>`,
    rewrites the text every 15 s, and polls `HEAD location.href` every 15 s,
    reloading once the response lacks `X-Beebox-Deploy`.
  - Wording: under 10 minutes — "This site is updating. The update started at
    9:41 PM, 3 minutes ago. Updates usually take about 4 minutes. This page
    reloads when the site is back." 10–60 minutes — "This update is taking
    longer than usual: it started 12 minutes ago, and updates usually take
    about 4 minutes." Over 60 minutes — "An update started at 9:41 PM and has
    not finished. Updates normally take about 4 minutes, so something has
    probably gone wrong." Unknown typical → "a few minutes".
  - `scripts/build-deploy-page.ts` bundles the entry with esbuild (IIFE) and
    writes `dist/deploy-page.html` with placeholders `__BBX_STARTED_MS__`,
    `__BBX_STARTED_UTC__`, `__BBX_TYPICAL_SECONDS__`. The server-rendered
    no-JS text states the UTC start time.
  - `bbx-deploy-window open <template>`: computes the median of the last 10
    `ok` windows (rounded, seconds) from `/var/lib/beebox-deploy/windows.tsv`,
    fills the template with digits only, writes it atomically (temp + `mv`) to
    `/run/beebox-deploy/deploy-in-progress.html` (dir 0755, file 0644), and
    stores the open time. `down`: stores the stop time. `close <rc>`: removes
    the page and appends `opened\tdown\tclosed\toutcome` to `windows.tsv`
    (keeps 200 lines), and prints `Deploy window: down <n>s (<outcome>)`.
    Directories overridable by `BBX_DEPLOY_WINDOW_RUN_DIR` /
    `BBX_DEPLOY_WINDOW_STATE_DIR` for the doctest only.
- **Vocabulary lock-ins:** `windows.tsv` columns; the three thresholds.
- **First chunk:** `deploy-page.ts` + build script + doctest of the wording
  and of the rendered page's script run in a VM.

### C. Deploy wiring, laptop timing record, phase timestamps

- **What:** the activation script opens the window before the stop and closes
  it from an EXIT trap; the laptop records each deploy.
- **Why:** the window must close on every exit of the server script, and the
  boxholder's "are deploys slower" needs per-deploy data.
- **Direction:** the top of `.activate-deploy.sh` becomes: nginx install (A),
  `trap 'bbx-deploy-window close $?' EXIT` (plus `HUP INT TERM` re-raised as
  exits), `bbx-deploy-window open "$stage_dir/beebox/dist/deploy-page.html"`,
  `bbx-deploy-window down`, then the existing `systemctl stop`. The helper
  runs from the stage copy, since the install dir is not yet updated.
  `/run` is tmpfs, so a reboot clears a stranded page. On the laptop, a
  `step` function prefixes each top-level progress line with a UTC time, and
  `record_deploy <outcome> <rc>` appends one JSON line per deploy that took
  the lock to `deploy/.deploy-logs/deploys.jsonl`:
  `{startedAt, endedAt, sha, outcome, exit, downSeconds}`. `downSeconds` comes
  from the `Deploy window:` line, captured by `tee` on the control ssh.
- **Vocabulary lock-ins:** `deploys.jsonl` fields; outcome values `ok`,
  `failed`, `unreachable`, `interrupted`.
- **First chunk:** helper + activation wiring + doctest of the helper.

### D. Real-signal detection

- **What:** detect an interrupt from the signal, not from the exit code.
- **Why:** ssh exits 255 on its own failures; `deploy.sh:80` reports that as
  "interrupted, not a failure" and skips the queued deploy (observed
  2026-09-16, per the issue). The timing record would carry the same lie.
- **Direction:** `trap 'on_signal INT' INT` (and `TERM`, `HUP`) sets
  `INTERRUPTED_BY` and exits 128+n. `deploy_exit` branches on
  `INTERRUPTED_BY`, not on `rc >= 128`. Exit 255 prints
  `Deploy failed (exit 255: the server could not be reached over ssh)` —
  keeping the `Deploy failed` prefix that `deploy/CLAUDE.md`'s poll matches —
  notifies "❌ beebox deploy FAILED — server unreachable", and chains like any
  other failure.
- **First chunk:** the trap change and a doctest that runs `deploy_exit`'s
  classification as an extracted function.

## Could this be simpler?

The simplest version is the static page + marker with "a few minutes"
hardcoded and the nginx edit applied by hand. It fails on (1) the boxholder's
question itself, "down 3 minutes or 2 hours?", once a deploy overruns, because
a hardcoded page cannot say it is late, per principle 13; (2) drift, because a
hand edit to the live nginx file is exactly the gap `deploy/README.md:147`
documents. The window helper is bash, not a new CLI verb, because it runs as
root before the new engine is installed. The page is built by esbuild only
because the boxholder's TS rule rules out a hand-written inline script; the
build adds one script that follows `build-box-docs.ts`.

## Subplans

none — the only design uncertainty (nginx mechanics) was settled by the spike.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Deploy process SIGKILLed mid-window; page stranded | helper doctest (reopen overwrites) | wording ages out at 10/60 min; next deploy overwrites; reboot clears `/run` | clear (page says it has gone wrong) |
| New nginx file fails `nginx -t` on the server | nginx doctest runs `nginx -t` on the file | restore `beebox.prev`, fail before the stop | clear (deploy fails, site up) |
| nginx reload fails after a good `-t` | no | `set -e` fails the deploy before the stop | clear |
| Live nginx file had hand edits the repo file lacks | no | one-time `beebox.pre-deploy-owned` backup on server | silent until noticed; boxholder accepted taking the file over |
| Page file unreadable by the nginx worker | nginx doctest writes 0644 in a 0755 dir | explicit modes in helper | clear (plain 502) |
| Hub down for a non-deploy reason | nginx doctest (no marker → 502) | marker absent | clear (plain 502) |
| Hub's own 503 masked by the page | nginx doctest (upstream 503 passes) | no `proxy_intercept_errors` | clear |
| Page serialized script broken by bundling | page doctest runs the built page in a VM | build fails the deploy | clear |
| `windows.tsv` missing or malformed | helper doctest | median ignores non-matching lines; unknown → "a few minutes" | clear |
| ssh 255 read as a signal | classification doctest | Track D | clear |
| Laptop killed; `deploys.jsonl` misses a row | no | none (no trap runs on SIGKILL) | silent; accepted — `.last-deployed-sha` and `bin/doctor.ts` already cover the undeployed-main symptom |

## Agent-flow / user-flow edge cases

- **Wrong field / wrong page:** ADDRESSED — only a 502/504 generated by nginx
  itself reaches `@hub_unreachable`.
- **Stale ref (stale marker):** ADDRESSED — Track B wording thresholds and
  Track C trap and tmpfs.
- **Two deploys at once:** ADDRESSED — the laptop lock (`deploy.sh:237`) and
  the server maintenance gate serialize activation; a second `open`
  overwrites atomically.
- **Hand-edit drift:** ADDRESSED — the deploy owns the file; a hand edit is
  overwritten on the next changed install, with `beebox.prev` kept.
- **Fabricated value:** ADDRESSED — the page shows only the recorded start and
  a median of recorded windows; no estimate when there is no record.
- **Open tab during a deploy:** ADDRESSED — the page reloads itself; the SPA's
  tRPC calls see 503, which `transient.ts:29` already retries.
- **Transition state:** the first deploy that ships this installs the nginx
  file before its own stop, so it is also the first deploy that shows the
  page.

## NOT in scope

- TLS listener / Cloudflare Full (strict) — the Flexible SSL issue; separate
  change, now deployable via the owned file.
- A failed-deploy page ("the update failed at X") — after a failure the window
  closes and a plain 502 means "down, not updating"; reconsider if failures
  prove common.
- Reducing the downtime itself (restart before migrations, blue/green) — the
  timing record is the input to that decision.
- Surfacing `deploys.jsonl` in the dashboard or doctor — the file answers the
  question; a view can come later.
- Batching deploy frequency — a policy question for the boxholder.

## Open design questions

None blocking. Lean recorded: the nginx doctest fails, rather than skips, when
`nginx` is not installed, with an install hint — the test tier has no skip
mechanism and this machine runs the suite.

## Knowledge audits

Skip: purely operational infrastructure; no box agent sees any of it.

## What will hold this after it ships

- `test/deploy/deploy-page.doctest.md` — wording thresholds, and the built
  page executed in `node:vm` with a stub document.
- `test/deploy/nginx-deploy-page.doctest.md` — starts a real nginx on the repo
  conf (paths and ports substituted), asserts the four spike behaviours.
- `test/deploy/deploy-window.doctest.md` — runs `bbx-deploy-window` against a
  temp dir: open/down/close, median, stale overwrite, malformed history.
- `test/deploy/deploy-exit.doctest.md` — outcome classification.
- The first live proof is the deploy that lands this; it is reasoned, not run,
  until then (Cloudflare, the Ubuntu nginx, the real trap under the
  maintenance gate).

## Implementation order

1. Track D (independent, smallest).
2. Track A conf + nginx doctest; setup-server switch.
3. Track B page module, build script, page doctest.
4. Track B helper + helper doctest.
5. Track C wiring in `deploy.sh`, phase timestamps, `deploys.jsonl`; docs in
   `deploy/README.md` and `deploy/CLAUDE.md`.
6. Cross-model review; fixes.

## Rollout shape

Done when the four doctests pass, `bash -n` and shellcheck (as the repo runs
it) pass on `deploy.sh` and the helper, typecheck and eslint pass. No data
migration; `windows.tsv` and `deploys.jsonl` start empty, so the page says "a
few minutes" until the first recorded window. Rollout is the landing deploy
itself; the boxholder checks the page live during the following deploy.
