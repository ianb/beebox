---
title: "Rename Callback Box to Bee Box"
status: draft
workstream: name-change-plan
issues: []
---
# Rename Callback Box to Bee Box

This plan renames the product and its operational surfaces without leaving a long-lived mixture of old and new vocabulary. It also installs a permanent check that makes completion measurable and prevents the retired name from returning.

This plan is deliberately unmerged until the rename is ready to execute. The repository is source-available, so merging the plan would announce the intended name before the boxholder chooses to announce it.

**Issues addressed:** none. A queue search found no issue that owns the product rename. The related `issues/decisions/2026-07-10-boxes-dead-callback-box-symlinks.md` concerns dead box symlinks, not this name change.

## Stated preferences this plan trades against

- **Complete beats cosmetically gradual.** Engineering principle 8 says, *"Competing idioms are drift generators"* and treats caller churn as migration work rather than a reason to preserve duplication (`docs/engineering-principles.md:95-104`). The rename therefore has one cutover, with compatibility code only where an external boundary cannot move atomically.
- **Enforcement beats memory.** Principle 11 says, *"A rule that matters gets a lint rule or a type, not a paragraph"* (`docs/engineering-principles.md:127-139`). A standing old-name check is a deliverable, not optional cleanup.
- **Failures must be loud.** Principle 4 rejects invisible degradation and requires seemingly impossible states to fail hard (`docs/engineering-principles.md:49-62`). Agent subprocesses must not silently resolve another program named `bbx`.
- **The maintainer is usually an agent.** Principle 12 says agent-maintained invariants must survive context loss through enforcement (`docs/engineering-principles.md:141-149`). The allowlist and inventory are machine-readable.
- **One historical account, not scattered qualifiers.** The boxholder wants one document to say what changed, when, and why. Other current documentation should simply use the new name. Git history remains the detailed record.
- **No implementation in this workstream.** This workstream designs and reviews the rename. It does not rename files, identifiers, services, domains, packages, applications, or accounts.

## What already exists

### Measured occurrence inventory

A tracked-file inventory on 2026-08-28, excluding `pnpm-lock.yaml` from line counts, found:

| Form | Matching lines | Files |
|---|---:|---:|
| `callback-box` (case-insensitive) | 7,032 | 1,533 |
| `CallbackBox` | 720 | 131 |
| `Callback Box` | 311 | 162 |
| `callback_box` / `CALLBACK_BOX` | 35 | 20 |
| `CB_*` | 1,813 | 410 |
| `com.callback*` | 17 | 11 |
| `/home/callback` | 139 | 46 |
| `cb.ianbicking.org` | 2 | 2 |
| `callback-box.zulipchat.com` | 7 | 6 |
| standalone `cb` token | 8,229 | 1,599 |
| slash/path `cb` segment | 589 | 166 |
| `.callback-box` | 651 | 288 |
| `.config/cb` | 70 | 37 |
| `x-cb-` | 169 | 54 |
| `cb_session` | 69 | 35 |
| `cb-*` compound | 2,038 | 599 |

The standalone `cb` count deliberately over-approximates the CLI: it includes config directory segments and other branded compounds that the scanner must classify before replacement. The broad old-name token appears in 1,201 Markdown files, 497 TypeScript files, 44 Swift files, 44 JSON files, and 3,064 tracked paths. The path count is high because every tracked file below the `callback-box/` subproject carries the old name in its path. `issues/` accounts for 653 affected files and 1,622 matching lines; `issues/closed/` alone accounts for 348 files and 920 lines. This is a repository migration, not a display-copy edit.

The implementation workstream must regenerate this inventory from a committed scanner before editing. The figures above are sizing evidence, not the completion oracle.

### CLI packaging and agent PATH control

- `package.json:2-24` names the package `callback-box` and publishes the `cb` executable through `"bin": { "cb": "./bin/cb" }`. Rename both independently: the package becomes a Bee Box package; its executable becomes `bbx`.
- `bin/cb:22-41` resolves symlinks back to the package and executes that package's bundle. Preserve this package-relative launcher shape as `bin/bbx`.
- `src/core/script-env.ts:34-37` derives the package's own `bin/` directory. `src/core/script-env.ts:96-101` prepends it to every box-spawned subprocess PATH so agents, tricks, procedures, and scheduled scripts find the package's CLI regardless of the parent shell. Reuse this seam.
- `src/core/script-env.ts:21-25` documents two subprocess profiles, agent-safe and tooling. Both flow through the same `buildEnv` PATH construction, so one strengthened assertion covers both profiles.
- `src/core/script-env-allowlist.ts:56` explicitly permits inherited `PATH`; the package bin directory must remain before that inherited suffix.

The current mechanism already shadows a system CLI for box-owned subprocesses. The rename must test the whole handoff rather than merely retest string prepending: `core/chat/session/start.ts:127-146` builds and passes the environment to the selected backend; `services/claude-chat.ts:86-102` places it in Claude SDK options; `services/codex-chat.ts:93-113` passes it to the Codex session; and `services/codex-sdk-session.ts:193-205` constructs the SDK with that environment. Tests must prove both backends receive a PATH whose first `bbx` is the package launcher. A foreign `bbx` later on PATH is allowed. A missing package launcher or a backend that drops the controlled environment is a hard startup/test failure.

### Existing guard precedent

- `bin/path-leak-check.ts:1-19` is a full-tree, generator-independent guard motivated by agents repeatedly reintroducing forbidden strings.
- `bin/path-leak-check.ts:41-47` keeps file exceptions explicit and near-empty.
- `bin/path-leak-check.ts:81-105` uses `git grep`, treats no matches as clean, reports each violation, and exits nonzero.
- `.husky/pre-commit:42-52` runs full-tree guards before the docs-only early exit, so prose and generated files cannot bypass them.
- `.husky/pre-commit:77-80` independently runs `doc-check` for Markdown changes.

Reuse the full-tree check and pre-commit placement. Do not overload `path-leak-check`; the retired-name policy needs its own inventory, allowlist, diagnostics, and tests.

### Existing named surfaces

- The root README calls the CLI *"the interface"* and names both the `callback-box/` subproject and the Zulip realm (`../README.md:1-18`, `../README.md:35-42`).
- The iOS project pins `app.callbackbox.ios` for debug and release (`../../ios-app/CallbackBox.xcodeproj/project.pbxproj:775-827`), with separate test and share-extension identifiers later in the same file.
- The deployment notifier uses `callback-deploy` as its terminal-notifier group (`deploy/deploy.sh:54-58`) and displays the old package name after a successful deploy (`deploy/deploy.sh:891-895`).
- Production instructions and scripts use the `callback` service account and `/home/callback`; for example, `deploy/README.md:241-246` documents the box directory, hub config, `.env`, and agent binary below that home.
- Launchd labels include `com.callback-box.schedules` (`../bin/doctor-checks.ts:18`), while older scheduler documentation also contains `com.callback.scheduler` (`docs/scheduler.md:16`, `docs/scheduler.md:101-109`). Both spelling families belong in the inventory.

## Prior art (external)

- GitHub redirects repository web and Git operations after a rename, but GitHub Actions references do not redirect. Existing clones should still update their remote explicitly. [GitHub: Renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)
- Apple says an App Store Connect bundle ID cannot change after a build has been uploaded; changing it then requires a new app record. Bundle-dependent entitlements and extensions also need coordinated updates. [Apple: Changing the bundle identifier](https://developer.apple.com/documentation/xcode/changing-the-bundle-identifier)
- Google says changing a verified OAuth app's name, logo, redirect URI, homepage, or privacy-policy link requires brand verification again; name and public identity must agree. [Google: Changes to approved app](https://support.google.com/cloud/answer/13464018)
- Zulip organization owners can request a cloud subdomain change. The old URL redirects for a limited period, all users are logged out, and integrations must be updated. [Zulip: Change organization URL](https://zulip.com/help/change-organization-url)
- `bbx` is not supplied by current Debian or Ubuntu package indexes, but it is already the command for BrowserBox, Browser Bridge, a Bitbucket Cloud client, and BuildBox. This is an accepted developer-tool collision, not an assertion of global uniqueness. Bee Box controls resolution inside its agent runner and refuses silent overwrite at install boundaries.

## Tracks / scope

### Track 1 — Lock the vocabulary and compatibility policy

**What.** Lock every canonical spelling before the mechanical sweep. The product display name is **Bee Box**. The CLI decision is also settled: `cb` becomes `bbx`.

**Why this needs to change.** A global substitution cannot infer word boundaries, API stability, environment migration, or platform identifiers. Starting the sweep without a vocabulary table would create competing forms.

**Direction.** Use this decision table:

| Surface | Bee Box | BeeBox | Beebox | Decision / friction |
|---|---|---|---|---|
| UI and prose | `Bee Box` | `BeeBox` | `Beebox` | **Decided: `Bee Box`.** It is legible as ordinary language and does not feel unnecessarily branded. |
| Machine slug | `beebox` | `beebox` | `beebox` | **Decided.** Repository, subproject directory, package, and domain use the compact slug without a hyphen. |
| camelCase | `beeBox` | `beeBox` | `beebox` | Rename branded variables only; domain concepts such as an individual `box` remain unchanged. |
| PascalCase | `BeeBox` | `BeeBox` | `Beebox` | Used for code symbols, Swift targets, and generated type names. |
| SCREAMING_SNAKE | `BEE_BOX_*` | `BEE_BOX_*` | `BEEBOX_*` | The CLI acronym does not dictate environment prefixes. Choose one branded prefix and migrate both current `CB_*` and `CALLBACK_*` names into it. |
| npm package | `beebox` | `beebox` | `beebox` | **Decided canonical package name.** The current `callback-box` package is not published on npm, so no registry transfer is required. Do not claim the unrelated `bbx` package merely to match the executable. |
| CLI executable | `bbx` | `bbx` | `bbx` | **Decided.** Short, intentionally machine-like, and agent-facing. Known niche collisions are accepted with controlled PATH resolution. |
| Repository/subproject | `beebox` | `beebox` | `beebox` | **Decided:** `https://github.com/ianb/beebox` and the `beebox/` subproject directory. |
| URL/domain | `beebox.run` | `beebox.run` | `beebox.run` | **Decided.** The compact domain is independent of display typography. Existing `cb.ianbicking.org` links become a redirect/migration surface. |
| iOS display name | follows product display | follows product display | follows product display | Can change without changing app identity. |
| iOS symbols/targets | `BeeBox*` | `BeeBox*` | `Beebox*` | Project, schemes, app/test/share targets, Swift symbols, filenames, and URL scheme need one coordinated Xcode edit. |
| Apple bundle IDs | candidate `app.beebox.ios*` | same | same | Sticky. See Track 6: determine upload status before deciding whether old IDs survive as identity-only exceptions. |

**CLI compatibility policy.** Land `bin/bbx` as the canonical launcher. Keep `bin/cb` only as a time-bounded compatibility shim for one migration release if boxes or external schedules cannot move atomically. The shim prints a deprecation message to stderr and forwards to the package-relative `bbx`; it never searches PATH. Remove it in a dated follow-up chunk. If all controlled boxes and production scripts can migrate in the same deployment, omit the shim entirely.

**Environment compatibility policy.** Inventory `CB_*`, `CALLBACK_*`, `.callback-box`, `x-cb-*`, and `com.callback*` separately. Rename process environment variables atomically and add one bootstrap boundary that detects any retired prefix and exits with the complete old-to-new mapping. Do not dual-read hundreds of scattered variables or carry both prefix families through the fail-closed subprocess allowlists. Rename the scenario harness as one unit—runner, `CB_TIME`, `CB_STUBS_FILE`, `CB_STRICT_FETCH`, allowlist, bootstrap readers, and tests—so a half-migration cannot turn a stubbed scenario into real network access. Persisted directories, cookies, and wire headers follow Track 4 rather than textual replacement.

**Vocabulary lock-ins.** The noun `box` remains a product concept. Only branded compounds change. Generic callback programming terms and OAuth callback URLs are not old-name occurrences.

**First implementation chunk.** Add the vocabulary table, exact old-name scanner, allowlist schema, and tests without renaming runtime surfaces. This chunk has no product-impacting behavior and gives subsequent commits a measurable target.

### Track 2 — Build the inventory and permanent old-name tripwire

**What.** Add `bin/old-product-name-check.ts`, a root script such as `pnpm old-product-name-check`, focused unit tests, and a pre-commit invocation beside `path-leak-check`.

**Why this needs to change.** The occurrence inventory spans code, prose, generated artifacts, paths, templates, operations, and historical material. Manual grep cannot prove completion, and a one-time sweep cannot prevent regression.

**Direction.** The scanner operates on tracked files and reports two classes:

1. **Path matches:** tracked path segments containing the retired product/package forms.
2. **Content matches:** case-aware patterns for display, kebab, compact, snake, env, service-label, header, directory, domain, and CLI forms.

Patterns must distinguish branded `cb` from ordinary substrings and distinguish the product name from generic “callback” programming language. Every pattern has a named occurrence class so output says what kind of migration remains.

Use an exact allowlist file committed beside the checker. Each entry contains:

```ts
{
  path: "callback-box/docs/name-history.md",
  occurrenceClass: "display-name",
  expectedCount: 1,
  reason: "The single historical decision record names the retired product."
}
```

An allowlisted count changing in either direction fails until the manifest is updated. Directory-wide exceptions, regex-only path exceptions, and “all historical docs” exceptions are forbidden. Migration compatibility code gets exact entries with a removal condition. Git history is outside the tracked-tree scan and needs no exception.

During execution, the checker supports an inventory mode that prints counts by occurrence class, top-level subtree, and extension. The normal mode fails on every nonallowlisted occurrence and on every stale allowlist entry. It runs:

- on every pre-commit, before the Markdown early exit;
- in the rename workstream's focused test command;
- in deployment/finish verification so `--no-verify` cannot become the only route to a mixed release.

**Vocabulary lock-ins.** Call it the “retired product name” check in new code. Do not put the retired name in the checker's filename, identifiers, or routine success output.

**First implementation chunk.** Implement the pure matcher and fixture tests, then wire its full-tree CLI and pre-commit entry. Initially run it in inventory mode on the rename branch; switch it to enforcement only in the commit that reaches the intended allowlisted baseline.

### Track 3 — Rename the repository and runtime surfaces

**What.** Rename tracked content and paths across the monorepo, packages, source identifiers, frontend text, generated artifacts, templates, plugins, tests, dev tooling, schedules, and companion projects.

**Why this needs to change.** The new display name is not complete while package imports, paths, generated agent prompts, or developer commands teach the old vocabulary.

**Direction.** Work from the scanner's occurrence classes rather than directory-by-directory memory:

1. Package and subproject paths, manifests, workspace declarations, imports, build scripts, and the CLI launcher.
2. Code symbols, constants, branded headers, config directories, cache paths, service labels, terminal-notifier groups, and environment names.
3. UI copy, metadata, docs, examples, screenshots and screenshot metadata.
4. Templates, generated agent guides, box rules/skills, plugin manifests, schedules, test fixtures, and checked-in generated output.
5. Root tooling and sibling projects: `callback-clerk`, iOS, site, workstreams app, research, issues, and repository guidance.

Regenerate artifacts from renamed sources where a generator exists. Do not edit generated output alone. Update test snapshots only after verifying the semantic change.

**Agent PATH invariant.** Rename `CB_BIN_DIR` to a neutral/new identifier and continue prepending the package's own `bin/`. Add a pure resolver check used by tests and an agent-runner startup assertion. Given a PATH containing both a fake foreign `bbx` and the package bin, the constructed agent/tooling PATH must resolve the package launcher first. Given a missing package launcher, startup fails with the expected and resolved paths. Ordinary shells are not rewritten globally; another `bbx` can remain available there.

**Historical tracked text.** Rewrite active and closed issues, implemented and unimplemented plans, research, and old reference docs to the new current vocabulary where the mention is incidental. Do not scatter “formerly …” annotations. When an old literal is necessary to understand a migration or historical event, move that explanation into the single name-history record or add one exact allowlist entry with a reason. The completed implementation plan itself must not become a second history narrative: after execution, delete this detailed plan rather than moving it intact to `implemented-plans/`; git history retains it and the decision record holds the durable account.

**First implementation chunk.** Rename package/CLI foundations and make agent PATH tests pass while keeping any explicitly chosen compatibility aliases. Do not begin prose bulk edits until builds can resolve the new package and executable.

### Track 4 — Migrate persisted and wire identities

**What.** Migrate `.callback-box/`, `~/.config/cb/`, `~/.local/share/cb/`, authentication/session files, cookie names, `x-cb-*` headers, generated box guidance, and box-authored schedules for both controlled and unknown source-available installations.

**Why this needs to change.** These names are state and protocol, not repository prose. A user can update the package while an existing box, schedule, browser cookie, or generated rule still expects the retired path or command. Controlled production inventory cannot account for every source-available install.

**Direction.** Classify each persisted identifier as one of:

- **move on first `bbx` invocation:** if only the old path exists, atomically move it and record the migration; if old and new both exist, stop with a conflict instead of merging silently;
- **read-old/write-new transition:** for browser cookies or headers where an in-flight client/server skew is realistic, accept the old wire name for one bounded release while emitting only the new name;
- **regenerate from source:** box guidance, rules, skills, completions, and schedules whose canonical source can be rebuilt;
- **identity exception:** only when a platform makes changing the identifier destructive, recorded in `docs/name-history.md`.

Published/source-available installs require a `cb` forwarding shim for at least one migration release because their existing scheduled commands cannot invoke a migration that is reachable only as `bbx`. The shim resolves its sibling package launcher directly, runs the persisted-state migration, warns, and forwards. Remove it in the next announced breaking release. If implementation establishes that no package has ever been published or installed outside controlled boxes, the boxholder may waive the shim with recorded evidence.

Add fixture coverage for old-only, new-only, both-present, partially migrated, and repeated invocation states. A migration is idempotent and never combines two state directories automatically.

**First implementation chunk.** Add a pure persisted-identity inventory and migration state machine with temporary-directory fixtures. Do not connect it to startup until package and CLI names are ready in the same branch.

### Track 5 — Migrate production infrastructure and controlled boxes

**What.** Migrate the production checkout, service account/home, systemd and launchd units, `.env`, config/cache directories, installed executable, box manifests, generated box docs, scheduled commands, and deployment scripts.

**Why this needs to change.** Repository completion can still deploy a broken server if systemd points to `/usr/local/bin/cb`, `.env` exposes only old keys, or box-authored schedules invoke the retired CLI.

**Direction.** Prepare a reversible server migration script before changing the deployed checkout. It inventories ownership, free disk space, unit definitions, symlinks, env keys, and every controlled box. It must be executable by the first post-merge deployment while the server still has its old account and paths: stage the new paths and executable links, validate them, switch units, and only then retire old paths. The deployment must verify:

- `command -v bbx` under the service account resolves the deployed Bee Box launcher;
- an agent spawned through each supported engine resolves the package launcher even when a fake foreign `bbx` precedes the inherited PATH;
- all systemd/launchd units reference new paths and labels;
- every box validates and regenerated guidance teaches `bbx`;
- the public health endpoint and an authenticated box operation work after restart;
- retired env keys are absent; any explicitly bounded wire-name compatibility is limited to the cookie/header readers in Track 4.

Do not inspect or mutate production without the boxholder's explicit approval. The implementation workstream prepares exact read-only and mutating commands separately and stops at the approval gate.

**Vocabulary lock-ins.** The production Unix account and home directory are infrastructure identifiers, not display copy, but the goal is still to rename them unless migration risk outweighs the benefit. If they survive, they become exact historical/compatibility exceptions with an owner and reevaluation date, not invisible leftovers.

**First implementation chunk.** Add the read-only production inventory and dry-run migration script, exercise it against an isolated server/container fixture, and present its output for approval. No production connection occurs in that chunk.

### Track 6 — Rename external services and sticky identities

**What.** Coordinate every name outside git. Each item has an owner, mechanism, stickiness, and done evidence.

| Surface | Owner | Mechanism | Stickiness / order | Done evidence |
|---|---|---|---|---|
| Primary domain: `beebox.run`; legacy host: `cb.ianbicking.org` | Boxholder; Cloudflare DNS | Configure the `beebox.run` zone, DNS, certificate, and proxy; update OAuth redirects and app config; then redirect the legacy host | Medium. Keep an HTTP redirect during bookmark/PWA migration; the domain is also an OAuth identity surface. | `https://beebox.run` passes health/auth; the legacy host redirects; DNS and Cloudflare config are exported or screenshot-recorded. |
| Cloudflare zones/settings and any Workers routes | Boxholder | Cloudflare dashboard/API using the existing deployment mechanism | Medium. `beebox.run` is a new canonical zone; `ianbicking.org` retains only the legacy-host redirect record/route for this product. | API/readback shows the intended `beebox.run` records/routes and the one legacy redirect. |
| GitHub repository | Boxholder/admin | Rename in repository settings; update local remotes, badges, package links, Actions consumers | Moderate. Git/web redirects survive, but Actions references do not. Never reuse the old repository name while redirects matter. | Fresh clone/fetch from new URL; inventory old URLs; external Actions consumers checked. |
| Zulip organization | Boxholder + Zulip support | Request realm subdomain rename and extended redirect | Sticky coordination. All users are logged out and integrations must change; default old-subdomain retention may be only three months. | New realm works, old realm redirects, integrations and published links updated. |
| Google OAuth app and consent screen | Boxholder; Google Cloud | Rename app/branding and update authorized origins/redirect URIs after new domain exists | Sticky. A verified app needs brand verification again; sequence before retiring old redirect URI. | Console readback plus successful login/connector grant through the new domain. |
| Production Unix account, home, services, `.env` | Boxholder; implementation agent with approval | Track 5 migration script and systemctl/ownership validation | High operational risk but reversible with staged paths and unit rollback. | Service-account `bbx`, units, file ownership, box validation, and authenticated smoke all pass. |
| Apple app display name | Boxholder/Xcode | Update Info.plist/App Store metadata with a new app version | Low-to-medium. Existing installs update normally if bundle ID remains. | Device build shows the new display name and share extension. |
| Apple bundle IDs, URL scheme, provisioning, push/app groups | Boxholder/Apple Developer | First determine whether a build has been uploaded. If not, rename identifiers together; if yes, choose retained legacy IDs or a new app record and device migration. | **Very sticky.** After first upload, bundle ID cannot change in place. A new ID creates a distinct app identity and can strand stored credentials, pairing state, push registrations, and installed-app continuity. | Apple portal/Xcode readback plus physical-device install, pairing, share extension, voice/capture, push, and upgrade/new-install checks. |
| terminal-notifier groups | Implementation agent | Rename group strings in deploy/dev scripts | Cheap, but old notifications may remain in Notification Center history. | One successful/failing notification uses the new group/title. |
| Published npm packages | Boxholder/package owner | Choose scoped Bee Box package, publish new package, deprecate old package with migration note | Sticky ecosystem boundary. Package names cannot be transparently renamed; consumers update dependencies. | Clean external install resolves package exports and `bbx`; old package is deprecated, not silently repurposed. |
| Browser bookmarks and installed PWAs | Boxholder | Update bookmarks; uninstall/reinstall PWAs after manifest/domain change | Manual and device-specific. Installed PWAs may retain old name/icon until reinstalled. | Checklist across desktop and mobile devices, with launch from each installed surface. |
| Local clones, shell completions, aliases, editor tasks | Boxholder/implementation agent | Update remotes, PATH setup, completion files, aliases, and saved tasks | Cheap but distributed. | Old-name inventory across known config locations, without reading unrelated personal content. |

**First implementation chunk.** Before repo cutover, reserve/confirm the chosen GitHub, domain, Zulip, npm-scope, and Apple identifiers. Record availability without creating or renaming external resources unless the boxholder explicitly authorizes each state change.

### Track 7 — Write one historical decision record and close the rename

**What.** Create `docs/name-history.md` as the only durable prose that explains the rename.

**Why this needs to change.** Future readers need a compact explanation, but widespread “formerly” notes would dominate searches and teach agents retired vocabulary.

**Direction.** The record contains:

- old and new display names;
- decision and cutover dates;
- one short reason for the new name;
- the canonical machine forms chosen in Track 1;
- a note that git history contains pre-cutover names;
- a compact table of intentionally retained legacy identifiers, if any, with why they could not change.

It does not duplicate the implementation diary, inventory counts, or service-by-service checklist. This plan is deleted at completion rather than preserved as a second narrative. Current docs, issues, examples, and code use the new name without parenthetical history. This includes quoted commands, error output, and transcripts in tracked closed issues and implemented plans: they are a maintained discovery corpus, not the canonical archive, and git history preserves their exact pre-rename text. The implementation does not solve that tension with hundreds of exceptions. Only runtime compatibility literals and immutable external identities may remain as exact allowlist entries.

**First implementation chunk.** Draft the record only after the final product spelling and sticky-identifier decisions are settled. Land it in the final cleanup commit so it reports what actually happened rather than what was intended.

## Could this be simpler?

The simplest plausible version is a broad textual/path replacement plus manual production edits. That changes the visible name quickly, but it cannot distinguish generic callback terminology, prove generated/operational coverage, control a colliding `bbx` inside agents, or stop later commits from restoring stale examples. The fuller plan adds one scanner, one exact allowlist, PATH assertions at the existing subprocess seam, and an owned external checklist. This complexity buys enforceable completion under principles 4, 8, 11, and 12; it does not add a generalized naming framework or daemon.

## Subplans

None. The vocabulary table and external checklist are contained here because their decisions directly order the single rename. If the Apple bundle-ID audit shows an uploaded build and state migration is nontrivial, split that work into an iOS migration subplan before implementation; do not improvise it inside the rename sweep.

## Failure modes

> **Critical gap until implementation:** the current tree has no old-name completion check. A partial rename can merge silently. Track 2 must land before the sweep and enforce the final baseline before release.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A new old-name occurrence is added after cutover | Planned unit + full-tree check | Pre-commit and finish/deploy block | Clear |
| A broad allowlist hides new occurrences | Planned exact-count allowlist tests | Broad entries are invalid; count drift fails | Clear |
| A file path retains the old subproject/package name | Planned tracked-path scan | Same blocking check as content | Clear |
| Claude or Codex drops the controlled agent environment | Planned backend handoff tests plus PATH precedence fixture | Package bin prepended before backend construction; missing launcher fails | Clear hard failure |
| Ordinary user shell already has another `bbx` | Deploy/package-install preflight planned where this repo controls linking | Identify owner and refuse silent overwrite there; npm/pnpm's own linking errors remain authoritative elsewhere | Clear |
| `cb` compatibility survives indefinitely | Shim test plus old-name allowlist expected count | Dated removal chunk; final check cannot pass with expired entry | Clear |
| A retired env key remains after atomic cutover | Planned bootstrap/env-boundary tests | Hard error prints the complete rename mapping | Clear |
| Scenario harness renames only some `CB_*` controls | Planned runner/allowlist/bootstrap integration fixture | Migrate the set atomically; real fetch remains forbidden in strict fixture | Clear |
| Old and new persisted state directories both exist | Planned migration-state fixtures | Hard error; never merge state implicitly | Clear |
| Production unit starts with an old path or env | Container/dry-run test plus approved prod smoke | Staged unit switch and rollback | Clear |
| A generated agent guide still teaches `cb` | Generated-output inventory and knowledge audit | Regenerate from source; old-name check blocks | Clear |
| GitHub rename breaks an Action consumer | External checklist | Inventory `uses:` links; update or preserve compatibility repo | Clear to CI, potentially delayed |
| OAuth brand/domain changes trigger verification delay | No local test | Start verification before retiring old redirect; keep overlap | Clear in Google console |
| Zulip rename logs everyone out or breaks integrations | No local test | Announce and update integrations; request extended redirect | Clear but disruptive |
| Bundle ID change creates a new iOS identity | Physical-device migration checks required | Decide retain-versus-new-record before editing Xcode identifiers | Clear if gated; destructive if missed |
| Installed PWA keeps the old name/icon | Manual device checklist | Reinstall after new manifest/domain is live | Otherwise silent/stale |
| Historical exceptions multiply | Old-name allowlist review test | One record; exact migration exceptions only | Clear |
| Bulk historical rewrites alter evidence or links | `doc-check`, diff review, link scan | Mechanical commits by occurrence class; preserve git history | Clear in review/checks |

## Agent-flow / user-flow edge cases

- **ADDRESSED — wrong executable:** Agent and tooling environments assert package-owned `bbx` resolution; a foreign later PATH entry cannot win (Track 3).
- **ADDRESSED — hand-edited scheduled command:** The full-tree scanner catches `cb …` in tracked schedules, templates, and box content included in the migration inventory; controlled boxes also run validation/regeneration (Tracks 2 and 4).
- **ADDRESSED — partial migration / transition state:** Package/CLI foundations precede prose; persisted identities have an idempotent state machine; production stages new paths before unit switch; external redirects overlap cutover (Implementation order).
- **ADDRESSED — stale generated guidance:** Rename generators first, regenerate, and scan output (Track 3).
- **ADDRESSED — two agents editing during the sweep:** Work by occurrence-class commits in one rename worktree; rerun the full scanner after rebasing immediately before landing.
- **ADDRESSED — fabricated free-form exception:** Allowlist entries require an exact path, class, count, reason, and removal condition for compatibility code. No directory exception exists.
- **ADDRESSED — validation error UX:** The checker reports path, line, occurrence class, matched spelling, and the command for inventory mode. Routine success is silent.
- **DEFERRED — third-party users with unknown scripts:** The repository is source-available but usage is not centrally observable. Publish package/CLI deprecations and a migration note; do not build telemetry for the rename.
- **DEFERRED — Apple identity continuity:** Gated on whether any build has reached App Store Connect and on a physical-device state inventory (Track 6).

## NOT in scope

- Executing any rename in this planning workstream.
- Designing a new product logo, icon, color system, or broader visual identity. Rename existing textual/metadata surfaces; brand design can be separate.
- Renaming the generic concept of a box or ordinary programming “callback” terminology.
- Rewriting git commit history, tags, or historical release artifacts.
- Claiming worldwide exclusivity over `bbx`; the plan accepts known niche collisions and controls the environments Bee Box owns.
- Building shell isolation for arbitrary human terminals. Deployment/package-link steps controlled by this repository refuse silent overwrite; agent/tooling subprocesses get deterministic PATH ownership.
- Creating telemetry to discover third-party installations or scripts.
- Changing unrelated package names such as `agent-doctest` or `personal-vibe-check`.
- Treating the domain, Apple bundle ID, or Unix username as automatically derived from display typography; each is an explicit operational decision.

## Settled design decisions

1. **Display and code:** **Bee Box** in UI and prose, `BeeBox` in PascalCase, `beeBox` in camelCase, and `beebox` as the compact repository/package/path/domain slug.
2. **CLI and environment:** `bbx` is the executable and `BBX_*` is the product-specific environment prefix. Inventory and migrate both current `CB_*` and `CALLBACK_*` sources; retain only third-party/generic names that are not product identity.
3. **Persisted and wire names:** `.beebox/`, `~/.config/beebox/`, and `~/.cache/beebox/` are canonical persisted locations. Use `x-bbx-*` headers and `bbx_session` cookies.
4. **Domain and repository:** `beebox.run` is canonical; `cb.ianbicking.org` redirects during migration. The repository becomes `https://github.com/ianb/beebox` and the monorepo subproject becomes `beebox/`.
5. **Apple identity:** No build has ever been distributed or uploaded to App Store Connect/TestFlight. Rename the app, test, and share-extension bundle IDs to `app.beebox.ios*`, plus URL schemes, entitlements, provisioning references, targets, schemes, and display names in one coordinated change.
6. **CLI compatibility:** `callback-box` is not published on npm. Do not ship a long-lived `cb` shim. Inventory and migrate every controlled source install, box schedule, hook, and generated guide atomically; if execution discovers an uncontrolled installation, stop and revisit this decision rather than silently preserving the alias.
7. **Production identity:** Rename the Unix account to `beebox` and its home to `/home/beebox` through the staged migration in Track 5.

## Knowledge audits

This rename changes core agent-facing vocabulary and commands. Update existing audits that expect `cb` and add at least:

- `beebox-cli-name`: the agent knows the product's canonical CLI is `bbx` and uses it in an ordinary command.
- `beebox-no-retired-cli`: the agent does not volunteer `cb` when asked how to validate or send a self-note.
- `beebox-identity`: the agent names the final display name and distinguishes the generic `box` concept from the product brand.

Run them against the isolated test box after generated guidance is refreshed. Record model, run count, and results. Knowledge audits do not prove PATH resolution; focused subprocess tests do.

## What will hold this after it ships

- `bin/old-product-name-check.test.ts` exercises every occurrence class, exact-count allowlist behavior, path matching, false positives for generic callback text, and stale exceptions.
- The full-tree `pnpm old-product-name-check` runs in pre-commit and finish/deploy validation. It is silent on success and lists actionable locations on failure.
- `src/core/script-env` tests construct agent-safe and tooling environments with a foreign `bbx` on inherited PATH and prove the package launcher wins; Claude and Codex backend tests prove that exact environment reaches each SDK.
- Persisted-identity migration fixtures cover old-only, new-only, conflict, partial, and repeated states without touching real user data.
- Package smoke tests install into a clean external fixture and verify exports plus `node_modules/.bin/bbx`.
- Docker/developer-install smoke follows a fresh Debian install through `bbx init`, serve, validation, and doctor.
- iOS simulator tests cover renamed targets/schemes and URL handling; physical-device checks cover installed identity, share extension, pairing, voice/capture, push, and PWA reinstall where applicable.
- `doc-check`, link checks, generated-output verification, and the old-name scanner cover the historical rewrite.
- External services remain a signed-off checklist because no local test can prove GitHub, Google, Apple, Zulip, Cloudflare, bookmarks, or device installs.

No new test tier is required. The risky decisions are expressed through pure scanner/PATH helpers and existing smoke/manual tiers.

## Implementation order

1. **Prepare neutral tooling on the private branch.** Add the scanner in inventory mode, persisted-state migration helpers, PATH/backend handoff tests, and dry-run production migration. Keep them private with the rename branch unless a branding-neutral subset is independently worth landing.
2. **Prove the migration in fixtures.** Exercise old/new/conflict persisted states, fresh package/Debian install, both agent backends with a foreign `bbx`, and a production-like container. Obtain boxholder approval for the exact production cutover commands.
3. **Declare the publicity and main-freeze window.** Once the boxholder is ready for the name to become public, pause conflicting main work for the short mechanical sweep and cutover. External services are prepared read-only but not renamed yet.
4. **Execute the scripted repository sweep.** Rename package/CLI foundations, code, atomic env/harness vocabulary, persisted/wire migration support, paths, prose, issue/history corpora, generated surfaces, iOS sources, and tests. Reduce the tree to the reviewed allowlist and enable enforcement.
5. **Rebase once and validate.** Rerun the complete inventory, package/Debian smoke, backend PATH tests, generated docs, knowledge audits, iOS automated checks, and cross-model review. Do not carry the sweep through a long-running sequence of rebases.
6. **Merge the complete repository rename.** This is the publicity point. The first post-merge deployment must understand the server's old paths and perform the approved staged migration; do not rename production before the merge.
7. **Cut over production immediately after merge.** Verify `bbx`, units, ownership, controlled boxes, health, and an authenticated operation. Retain rollback until checks pass.
8. **Rename external services in dependency order.** Activate the prepared domain/Cloudflare changes, complete OAuth branding/redirects, rename GitHub/Zulip/npm surfaces, and update published links and integrations. Apple identifiers ship with the coordinated native build after the repository cutover.
9. **Complete device/manual migration.** iOS fresh-install checks, share extension, push, bookmarks, and PWA reinstalls.
10. **Write the single history record and remove transitional evidence.** Create `docs/name-history.md`, remove any compatibility paths whose promised window has ended, delete this plan, and verify the old name appears only in exact approved locations.
11. **Release the main freeze.** Confirm external redirects and the old-name enforcement check, then resume ordinary main development.

## Rollout shape

Tests lead each phase:

1. Scanner unit tests define what “old name” means before the sweep.
2. PATH and backend-handoff tests define deterministic `bbx` ownership before agents see the new CLI.
3. Atomic env/harness and persisted-state tests define conflict and retry behavior before production keys or user state change.
4. Package/Docker smoke proves a clean install before the repository and production cut over.
5. Knowledge audits prove generated agent guidance after the content sweep.
6. External and physical-device checklists close surfaces local automation cannot reach.

The repository transition may use multiple commits but has one ship boundary. Before that boundary, rebase on current main, rerun the occurrence inventory, and resolve new matches. At the boundary, the done conditions are:

- all automated checks pass, including a full old-name scan at the exact allowlisted baseline;
- agent-safe and tooling subprocesses resolve the package-owned `bbx` with a foreign collision present;
- a clean external package install and Debian smoke pass;
- controlled boxes migrate, regenerate, and validate;
- production passes approved health and authenticated-operation checks;
- external-service owners sign off or an explicit sticky exception appears in `docs/name-history.md`;
- iOS/PWA/manual device checks are recorded accurately;
- no scattered “formerly” prose remains;
- this planning document is removed, leaving one historical record plus git history.
