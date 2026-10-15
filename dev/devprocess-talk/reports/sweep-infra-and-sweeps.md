# Infrastructure and sweeps, 2026 timeline lists

Dates come from the commit that landed the work, not from plan-file dates. Old product name appears only as `<old-package>` (the 2026-08-30 rename commit is dab834811).

## LIST A: infrastructure (work the product runs on; no visible feature)

January (first week only)
- 2026-01-28 5f52c52cf: A schema registry validates every card on load.
- 2026-01-28 23e23d783: The first card-parsing library (XML) goes in as its own package.

February
- 2026-02-21 b49e118e4: A job-card reactor runs queued work from cards (full loop with polling: 8e4e0fa61).
- 2026-02-24 e1110cc3c: One server process serves several boxes; scripted work auto-commits with provenance trailers.
- 2026-02-25 a33147b19: Server runs behind a Cloudflare Tunnel (trusted proxy headers, no wildcard CORS).
- 2026-02-28 b15d6adb7: Deploy scripts provision a cloud server.
- 2026-02-28 d6a0ea053: Google sign-in gates access; chat sessions come from a pool.

March
- 2026-03-03 749201dca: tRPC and TanStack Query adopted for the API layer (all frontend moved by 2026-03-04, 032e914ca).
- 2026-03-03 da1d0bfef: Git operations go through simple-git.
- 2026-03-04 6151d4621: Audio and image files tracked with Git LFS.
- 2026-03-08 d4f945c78: Events move to a SQLite-backed event bus.
- 2026-03-09 8695e99d2: Box access defaults to owner-only.
- 2026-03-30 a23980304: Google OAuth tokens stored centrally, with a per-box service policy.

April
- 2026-04-12 f8e524b32: Fix git index.lock collisions caused by LFS post-commit hooks (first of the git-locking line).
- 2026-04-19 6deac8479: Activities framework (base classes, registry, CLI, tRPC) lands.

May
- 2026-05-16 e061cfd27: Attach manifests (a directory-walk scheme for tracking large files; replaced 2026-09-14).
- 2026-05-22 24a35685d, ae0bf23b9: Cards move from XML to Markdown with YAML frontmatter; a dispatcher reads both formats.
- 2026-05-27 4fa962695: Dev router proxies WebSocket upgrades as well as HTTP.
- 2026-05-31 07a9d8d49: Monorepo switches from file: dependencies to a pnpm workspace.

June
- 2026-06-08 cc7a1efbe: Chat and events move to a tRPC WebSocket transport (event bus ported in cd1139c80).
- 2026-06-18 fc33a9620 (and four sibling commits): Remaining card schemas migrate from XML to YAML frontmatter.
- 2026-06-19 1130a7fed: The old card-parsing package is deleted, with a box data migration (box-migration plan).
- 2026-06-21 4e557de9c: Agent-applied migrations: a migration can be a checklist an agent follows.
- 2026-06-21 2fe08931b: Streaming and finished chat turns become one stably keyed element.
- 2026-06-28 5f72d297a: Box-local schemas hot-reload in the running server (race fixes df17b3c92).
- 2026-06-30 93fc76d69: App-wide Content-Security-Policy (report-only first, with a violation log, d84cf7957).

July
- 2026-07-02 aee3d6452 to 8f1aba23e: REST routes consolidate into tRPC procedures.
- 2026-07-04 df558b9b5, 37cdf8a5a: Many boxes run behind one hub that terminates login (boxes as installable packages, v2).
- 2026-07-07 d197e465c: Authenticated iOS pairing.
- 2026-07-12 b7cfc0a98: Docker image, compose file, and entrypoint.
- 2026-07-17 e577200a7: Shared mobile-contract fixtures and a tripwire test.
- 2026-07-19 b561377d2: Local password login with first-run setup and login throttle (auth on by default).
- 2026-07-20 d6b8417a4, 30249b2fd: Router binds loopback only; Tailscale exposure tooling fails closed.

August
- 2026-08-01 873b37e16: Scan-upload tokens get their own store, with enforcement at hub and box (scan wire contract).
- 2026-08-15 b10769dea: Codex backends run through the official Codex SDK (finalized 360022e13).
- 2026-08-17 4942d9be4: Machine-level secrets store with a resolver; every connector reader moves onto it (af5fd87ce).
- 2026-08-18 fe1dd15f6: Box git lock serializes writers on the repo index (every mutator takes it, de33ed568).
- 2026-08-19 eec37ff7a: Pending box migrations apply automatically on deploy.
- 2026-08-20 3cd5c0fb3: A new chat gets its session id before the chat exists (coined chat ids).
- 2026-08-23 54f1e6569: A failing connector sync no longer stops the others.
- 2026-08-30 99ddf9b23: Product-rename migration rewrites every machine manifest and preserves chats (e84edc49d).

September
- 2026-09-04 d7d3a19d3, 6515e93ad: One-root box layout (shape v3) and its conversion (a package root no longer exists).
- 2026-09-14 21b137dd2, cd650c6ca: git-annex replaces Git LFS and the manifest scheme; `init` creates annex-shaped boxes.
- 2026-09-14 969d97fa5: Migration, deploy, and reload share one maintenance mechanism with an owner lock.
- 2026-09-17 a3f6da9bc: Box agents install system packages through a root-owned wrapper (host packages, 23f0ee436).
- 2026-09-18 a94ba467b: Maintenance page served while production restarts; deploy timings recorded.
- 2026-09-26 f695d5d98, 6d88688a1: Push-notification delivery channels and key plumbing (APNs, VAPID).

October
- 2026-10-08 81c647230: All box data migrations retired (133 files) after every box converged.
- 2026-10-09 47556b30a: Boxes author AGENTS.md instead of CLAUDE.md (agents-md migration).
- 2026-10-10 2393201e5, f5939bdec: Plugins slice 2: scoped Markdoc tags and the recipe type move into a plugin.
- 2026-10-10 7a689a9f6: Core tags retired by the body-tags-2026-10 migration.

## LIST B: sweeps (one-off campaigns)

Format: date or range, hash, size, what, standing check left behind.

- 2026-05-30 to 05-31, b53159500 (start) to 8965f1d36 (end): ESLint suppression ratchet burned from about 1,000 suppressions to 0; largest commits 145 files (497c5c529). Left: the no-disable guardrail in lint; ratchet file itself removed.
- 2026-06-19, 1130a7fed: Delete the old card-parsing package, 101 files; follow-ups 2026-06-20 and 07-01 removed XML remnants. Left: nothing standing (code gone).
- 2026-06-21, d7a1251dd and daf89db2c: Declare `ts` on every doctest fence (147 files); group doctests into subdirectories (152 files). Left: doctest runner enforces the fence tag.
- 2026-06-26, 36ac65226 (catalog) with 3fd5e4c9e, 4c7f3b9aa: User-story catalog extracted (5,889-line generated file) and 95 audit comments triaged. Left: catalog regenerates; 2026-08-21 24db79325 lets git say which stories need freshening.
- 2026-07-03, 92a81373d to 387bab964 (batches 2-9), e0e8e4f5c: Knowledge-audit rerun over every audit in nine batches; 8 real gaps closed in prompts (13 files). Left: audits stay runnable, rerun after guidance changes.
- 2026-07-04, 7b9646c98 and d5e428a87: Docs reorg (eight tracks) and plans-taxonomy sweep, 165 files; ideas.md replaced by one-file-per-issue (2c6c497c2, 122 files). Left: doc checks for links and placement.
- 2026-07-05 to 07-06, b7e3ac0d2 to cbea9a43f; follow-ups 2026-07-09 to 07-10 (e3f891a57): Architectural review, 17 scans, plan then engineering-principles doc (cc94b4c28). Left: engineering principles doc; lint ratchets from the follow-up round.
- 2026-07-09, f01f36084: Path-scoped commits across about 31 sites, documented as a convention. Left: convention doc only.
- 2026-07-10, 1694cc239: Issues sorted into subdirectories with titles in frontmatter, 167 files. Left: issue browser relies on the layout.
- 2026-08-09, b66aed4f3: Plan and issue frontmatter schema applied to 613 files. Left: enforced by a check.
- 2026-08-24, 056d74686 (342 to 4 unused exports, 151 files), then 21c0de050, 56fae9331: Knip backlog cleared. Left: weekly scheduled knip-sweep (not a commit gate); more batches 2026-09-23 (8177358b5), 10-02 (c748e1209), 10-07 (b5073f475).
- 2026-08-25, 5e2e4e288, ab59e4ebe: Last logic .mjs files and every eslint.config.mjs converted to TypeScript. Left: rule in AGENTS.md that .js/.mjs are loaders only.
- 2026-08-28, c931b8efa: bin/ TypeScript linted under the reviewed ruleset, backlog burned down (133 files). Left: lint covers bin/**.
- 2026-08-30, dab834811: Product rename to Bee Box across 4,188 files (old name `<old-package>`), plus machine-manifest migrations (99ddf9b23). Left: path-leak and blocklist hook blocks the old name.
- 2026-09-02, 6d172a0d3 and c938f7a0b: UI copy and vocabulary sweep (chat, box, thinking), 33 files. Left: vocabulary glossary.
- 2026-09-04, b51f0675a: One-root consumer sweep, 527 files; retired packageRoot and re-pointed every v2 path. Left: none beyond the layout.
- 2026-09-12, 880f9d4d0 (with 0aea01bd2, d0bb5a895): Calibration rewrite of instruction files. Left: calibration plan and size lint for instruction files.
- 2026-09-24 to 09-26, 26022b623 to 8572c248c: doc-structure plans (cards, chat, connectors, development, install-server, media, prompts, box-guidance) restructure docs like code. Left: section-hash check in the plan, doc-graph regeneration.
- 2026-09-27, 228b71fb2 (check), 079410e97, efb613eb9, 2558bb3c0, 3f1935840, ceaf0cd57, b70dedfa8, 8e3a98c0a, 3b5d64ca0: Layout moves, 8 commits of 154 to 736 files, then path-mention rewrites (881eb9dab 301 files; 29532938c 316; 8e8099de7 211). Left: `pnpm layout-check`, run in pre-commit (d5f271f0e).
- 2026-10-02 and 10-07, c748e1209, b5073f475: Knip batches after the layout moves (55 and 42 exports dropped). Left: weekly sweep.
- 2026-10-06, 2cc04dbdf: 21 standing oxlint warnings cleared, 17 files. Left: oxlint stays in the lint gate; supplemental-lint keys findings by rule.
- 2026-10-07, 04bae7e91 (retirement), ea52a35b8 (report): Skills review with usage counts; six skills retired (first commit shown retires two), 19 files. Left: the report with per-skill recommendations.
- 2026-10-08, 81c647230: Retire every box data migration, 133 files. Left: migration-admission checks only for current migrations.
- 2026-10-09, 3ea06edcf (355 files), 29d900c00 (321 files): CLAUDE.md renamed to AGENTS.md across the dev repo; stale mentions retired. Left: instruction-file size lint renamed (f8b42146d); publish blocks AGENTS.md (514dce580).
- 2026-10-10, 7a689a9f6: Four core Markdoc tags retired from all cards. Left: body-tags-2026-10 migration.

Other candidates found (smaller): 2026-08-03 cdb3fb8a2 retired a skill and deleted a vendored one; 2026-07-05 21b4eea7c secret scan of history (clean), left a gitleaks gate config.

Verification notes: hashes, dates and file counts come from git log. The "Left" phrases are verified for the layout check, knip schedule, frontmatter enforcement, and AGENTS.md lint rename; the others are inferred from commit subjects and should be checked before the talk. The skills-review count of six retirements was given in the brief; the commit shown retires two (bbx-codehealth, canvas-loop-sketch).
