---
title: "Markdown link validation — turn it on, make it correct, close the commit-time hole"
status: implemented
workstream: unknown
issues: []
---
# Markdown link validation — turn it on, make it correct, close the commit-time hole

The box's broken-internal-link rule (CB002) has never run: it's disabled in
config, and the one place it *would* fire has a path-resolution bug that would
false-positive every valid box-root link. As a result a `git mv` of store
content silently left a dossier full of 404'd image links — and `bbx mv` itself
would *not* have prevented it, because its ref-rewrite skips plain `.md` files.
This plan enables and fixes the rule, makes `bbx mv` rewrite links in `.md`
dossiers too, nudges agents away from raw `git mv` on store content, and adds a
box-wide broken-link warning at commit time so breakage surfaces regardless of
cause. The pre-existing breakage is left to surface via the warning and be
repaired through `bbx mv` adoption rather than a one-time scripted rewrite.

## Stated preferences this plan trades against

- `beebox/CLAUDE.md:101` — *"Read before writing. Don't guess file
  formats, XML structures, or API shapes. Read the schema, read the existing
  code, read the test patterns."* — every design choice below cites the code it
  builds on.
- `beebox/CLAUDE.md` (Validation section) — *"`.git/hooks/pre-commit` —
  runs `bbx validate --staged`, blocks commits that include cards failing
  validation."* This plan keeps the staged-card **block** intact and adds a
  box-wide link **warning** alongside it; it must not weaken the card gate.
- `beebox/CLAUDE.md` (Behavioral Notes) — *"Leave the repo clean when
  committing. Fix any lint/type/test errors you encounter (even pre-existing
  ones)…"* — the data-cleanup track exists because enabling the rule surfaces
  pre-existing breakage that shouldn't be left lying around.
- User-global rule (project CLAUDE.md) — *"NEVER disable or weaken a lint rule to
  make code pass."* The entire bug is a disabled rule; the fix is to turn it
  **on** and fix the code, never to keep it off or degrade it.
- `beebox/code-style.md` — no `any`, double quotes, semicolons, max 2
  positional params (named-params object beyond that), `as` only at parse
  boundaries with justification. The `params.config` read in the rule is exactly
  such a boundary.
- `beebox/docs/testing.md` — tests as a design tool; name the doctest for
  each new codepath as part of designing it. The Failure-modes table's
  "Test exists?" column is encoded as the doctests in Rollout shape.

## What already exists

- `beebox/src/core/markdown-lint-rules.ts:39-69` — `noBrokenInternalLinks`
  (CB002), `tags: ["links"]`, `asynchronous: true`. Line 46:
  `const fileDir = path.dirname(params.name);` Line 55:
  `const filePath = path.resolve(fileDir, url.split("#")[0]!);` — the
  root-resolution bug: a leading-`/` url makes `path.resolve` discard `fileDir`
  and resolve against OS root. **Reuse + fix in place** (Track A).
- `beebox/src/core/markdown-lint-rules.ts:71-75` — `isRelativePath`:
  returns `true` for `/store/...` (no `#`, no scheme), so absolute box-root links
  already flow into the resolve path. **Reuse**; the fix is in how that path is
  resolved, not in this predicate. Relative links (no leading slash) keep
  resolving against `fileDir` unchanged.
- `beebox/src/core/markdown-lint-rules.ts:17-37` — `noViewLabelLinks`
  (CB001), also `tags: ["links"]`, needs no boxRoot. **Reuse**; just enable it.
- `beebox/src/cli/commands/validate.ts:78-86` — `MARKDOWN_CONFIG`
  (`{ default: false, MD009, MD037, MD038, MD047 }`) and
  `CUSTOM_RULES = [noViewLabelLinks, noBrokenInternalLinks]`. **Reuse + edit**:
  enable CB001/CB002 by name; pass boxRoot.
- `beebox/src/core/sdk-hooks.ts:22-23` — the second, identical
  `MARKDOWN_CONFIG` + `CUSTOM_RULES`. **Reuse + edit** the same way. The box root
  is available here as `post.cwd` (already used as `boxRoot` for card lint at
  `sdk-hooks.ts:123`).
- `beebox/src/cli/commands/validate.ts:40-50` — `listStagedCards(boxRoot)`:
  `git diff --cached --name-only --diff-filter=ACMR`, filters `.card`, skips
  trash, maps to absolute paths. **Mirror** for markdown (Track C).
- `beebox/src/cli/commands/validate.ts:88-103` — `findMarkdownFiles`: skips
  `SKIP_DIRS` (`node_modules`, `.git`, `.pnpm`, `.claude`) and `SKIP_FILES`
  (`CLAUDE.md`). **Reuse the exclusion set** for both staged-markdown collection
  (Track C) and the box-wide commit scan (Track D), so all three paths agree on
  what counts as a lintable md file.
- `beebox/src/cli/commands/validate.ts:236-245` — `collectStagedResults`:
  hardcodes `mdSummary: null`. **Edit** to also collect+lint staged markdown
  (Track C).
- `beebox/src/cli/commands/validate.ts:247-256` — `collectAllResults`:
  already lints every box markdown file via `lintMarkdownFiles`. **Reuse** as the
  basis for the box-wide commit scan (Track D) — the scan is "the markdown-link
  portion of `--all`, run non-fatally."
- `beebox/src/core/install-validation-hooks.ts:44-72` — `preCommitBody`:
  gates `bbx validate --staged` on `grep '\.card$'`. **Edit** to also lint staged
  `.md` and to add the box-wide link warning step (Track D).
- `beebox/src/core/commands/move-operations.ts:178-216` +
  `beebox/src/core/rewrite-card-refs.ts` (note: `src/core/`, not
  `src/core/commands/`) — `bbx mv`'s resolution-based ref rewrite. **Today it
  iterates cards only** (`rewriteOtherCards`, `cardAbsPath`-keyed): refs in plain
  `.md` dossiers are never rewritten. Inline-markdown-link coverage is documented
  at `move-operations.ts:8` and `rewrite-card-refs.ts:17`, but only *within cards*.
  **Edit** so the referrer scan also covers `.md` files (Track E). This is *the*
  reason the dossier broke even though the bbx-side machinery existed.
- `beebox/src/dev/knowledge-audits.yaml:1-40` — audit format
  (`id`, `prompt`, `expected_level`, `watch_for`, `correct_contains`, `tags`).
  **Reuse** for the two new audits (Knowledge audits section).

## Prior art (external)

- **markdownlint per-rule config / parameterizing a custom rule.** markdownlint
  passes the rule's effective config to the rule via `params.config`; setting a
  rule's config value to a non-`false` object both *enables* it and supplies
  options. This is the documented mechanism for a configurable custom rule (see
  markdownlint `doc/CustomRules.md` and the `Rule.function` `params.config`
  field). Chosen over a closure factory because it keeps the rule a stable
  singleton export. URL: https://github.com/DavidAnson/markdownlint/blob/main/doc/CustomRules.md
- **Enabling a custom rule under `default: false`.** A custom rule registered via
  `customRules` runs only if enabled by one of its `names` or by a `tags` entry
  in config. With `default: false` and neither present, it silently no-ops — this
  is the exact failure here. Enabling by **tag** (`links: true`) would also switch
  on built-in link rules (MD011, MD039, MD042, MD051–MD054, MD059); enabling by
  **name** does not. We enable by name. URL: https://github.com/DavidAnson/markdownlint/blob/main/doc/Rules.md
- **`path.resolve` with an absolute second argument.** Node documents that
  `path.resolve` processes right-to-left and stops once an absolute path is
  built, so `path.resolve("/a/b", "/store/x") === "/store/x"`. This is the
  root-resolution bug, not a markdownlint quirk. URL: https://nodejs.org/api/path.html#pathresolvepaths
- No prior art found for the "warn box-wide on broken links at commit so a move's
  collateral surfaces" posture — it's box-specific (filesystem-as-state with
  absolute box-root links). Designed fresh in Track D.

## Tracks / scope

Ordered by implementation dependency, then surface size. A → B make the engine
correct and live; C → D close the commit-time holes; E fixes `bbx mv` for `.md`;
G nudges away from `git mv`; F sizes (but does not script-repair) the existing
breakage. A–B unblock everything; C, D, E, G are independent of each other; F is
last (it needs the fixed rule to size accurately).

### Track A — make `noBrokenInternalLinks` box-root-aware (boxRoot required)

**What.** Teach CB002 the box root so a leading-`/` link resolves against the box
root, not the OS filesystem root.

**Why this needs to change.** `markdown-lint-rules.ts:55` resolves `/store/...`
against OS root, so the moment the rule is enabled every *valid* box-root link
false-positives. Without this fix, Track B (enabling) is unusable.

**Direction.** Parameterize via markdownlint's per-rule config (not a closure
factory):

- Read the box root from `params.config`:
  ```ts
  // params.config carries this rule's config object; boxRoot is supplied by the
  // caller's markdownlint config (Track B). Parse-boundary read.
  const cfg = params.config as { boxRoot?: string };
  const boxRoot = cfg.boxRoot;
  ```
  (`as` allowed as a parse-boundary cast per code-style.md; add the mandated
  `// eslint-disable-next-line no-restricted-syntax -- parse boundary` only if the
  lint config flags it.)
- **boxRoot is required.** If it's missing, that's a programming error — the rule
  **throws** (a clear custom error naming the rule and that a caller must supply
  `boxRoot`). It does **not** silently skip absolute links: linting something the
  wrong way, or pretending to lint while not, is itself a bug. (Earlier draft
  proposed a silent-skip degrade mode; rejected — fail loud.)
- Resolution becomes leading-`/`-aware; relative links are unchanged:
  ```ts
  const rel = url.split("#")[0]!;
  const filePath = rel.startsWith("/")
    ? path.join(boxRoot, rel)          // box-root absolute
    : path.resolve(fileDir, rel);      // relative to the file (unchanged)
  ```
  Use `path.join(boxRoot, rel)` (not `path.resolve`, which re-triggers the
  absolute-arg discard).
- **Containment (Codex #5).** After resolving, normalize and require the target to
  stay inside the box: `resolved === boxRoot || resolved.startsWith(boxRoot + path.sep)`.
  Otherwise a `..`-escape (`/../../outside` or relative `../../outside`) that
  happens to resolve to a real file on disk would pass as "exists." A genuine
  out-of-box reference uses a different syntax entirely (it is *not* a `/`-absolute
  or relative file path — boxholder), so an internal-link path that escapes the
  box is unambiguously an error to flag, not a valid external link.
- `fileExists` (`markdown-lint-rules.ts:77-85`) already returns true for
  directories, so "a ref may point to a file **or** a directory" needs no change.
- Update the rule `description` from *"Relative links must point to existing
  files"* to *"Internal links (relative, or box-root absolute) must point to an
  existing file or directory."*

**Vocabulary lock-ins.** Config key `boxRoot` (camelCase, matches the term used
throughout `validate.ts`/`sdk-hooks.ts`). Rule names `CB002` /
`no-broken-internal-links` unchanged.

**First implementation chunk.** Edit `markdown-lint-rules.ts`: `params.config`
read, required-boxRoot throw, leading-`/` branch, description update. No open
questions inside.

### Track B — enable CB001 and CB002 in both configs

**What.** Turn the two custom rules on, by name, in both `MARKDOWN_CONFIG`s, and
pass each call its box root.

**Why this needs to change.** `default: false` plus no per-rule enable means both
custom rules silently no-op everywhere today (`validate.ts:78-84`,
`sdk-hooks.ts:22`).

**Direction.** In **both** sites the config becomes (illustrative):
```ts
const markdownConfig = {
  default: false,
  MD009: true, MD037: true, MD038: true, MD047: true,
  "no-view-label-links": true,
  "no-broken-internal-links": { boxRoot },
};
```
Enable **by name**, never the `links` tag (prior art). Because `boxRoot` is now
part of the config, it can't be a module-level constant — build it per call from
the box root; the rule *array* stays static (the payoff of config-over-factory):

- `validate.ts`: thread `boxRoot` into `lintMarkdownFiles`
  (`lintMarkdownFiles(files, { boxRoot })`, currently `:112`) and build the config
  inside. Callers `collectAllResults` (`:252`) and `collectExplicitResults`
  (`:268`) already have `boxRoot`.
- `sdk-hooks.ts`: `runMarkdownLint(filePath)` (`:106`) gains a box root. **Do NOT
  use `post.cwd` (Codex #1).** In a landmark chat session `cwd` is set to a
  landmark *subdirectory* with the box root only added as an additional directory
  (`chat-session-start.ts:106`/`:120`), so `post.cwd` can be deeper than the box
  root — `/store/...` would then resolve under the landmark dir and false-positive.
  Resolve the real root with `findBoxRoot(post.cwd)` (`src/cli/lib/paths.ts:81`,
  returns the box root by walking up, or null). If it returns null, skip markdown
  link validation for that call rather than guess. (Note: the existing
  `runCardLint` at `:123` trusts `post.cwd` as boxRoot — same latent issue; out of
  scope to fix here, but do not *propagate* the pattern to the new markdown path.)
- **Write-time surface parity (Codex #2).** Two write-time hook surfaces exist and
  only one is fixed by the config change. The in-process SDK hook
  (`runMarkdownLint`) handles `.md` — good. But the *installed shell hook*
  (`.claude/settings.json` → `bbx validate --hook`, `install-validation-hooks.ts:86`)
  runs `runHookMode`, which `process.exit(0)`s for any non-card markdown file
  (`validate.ts:192`) — so a Claude-Code-in-box hand-edit of a dossier gets **no**
  markdown link warning. Extend `runHookMode`: add an `isMarkdownFile(fp)` branch
  (helper already imported, `validate.ts:14`) before the `:192` card check, that
  resolves the box root (`requireBoxRoot`), lints the file with the link rules, and
  exits 2 on findings (matching the warn-not-block nudge semantics the hook already
  uses for cards/views). Skip `CLAUDE.md` and `.claude/` paths to match
  `findMarkdownFiles`.

**First implementation chunk.** Edit both config sites; thread `boxRoot` through
`lintMarkdownFiles`; resolve the real box root in `runMarkdownLint` via
`findBoxRoot`; add the `isMarkdownFile` branch to `runHookMode`. Depends on A.

### Track C — `--staged` validates staged markdown

**What.** `bbx validate --staged` should collect and lint staged `.md` files, not
just cards. Markdown you directly stage is validated like a card you stage.

**Why this needs to change.** `collectStagedResults` hardcodes `mdSummary: null`
(`validate.ts:244`), so even with the rule live, a commit that stages a markdown
change gets no validation of *that file*. (The orthogonal case — a move breaking
links in *unstaged* referrers — is Track D.)

**Direction.**
- Add `listStagedMarkdown(boxRoot)` mirroring `listStagedCards`
  (`validate.ts:40-50`): same git plumbing, filter `.endsWith(".md")`, apply the
  **same exclusions** `findMarkdownFiles` uses (drop `CLAUDE.md` and `.claude/` et
  al.) so `--staged`, `--all`, and the Track-D scan agree. Factor the
  "is this a lintable md path" predicate so all three share it.
- In `collectStagedResults`, also accept explicit `.md` paths from `resolved`
  (today it unions only `.card` — `:238`), lint the union via
  `lintMarkdownFiles(..., { boxRoot })`, return a real `mdSummary`.
- Posture: a staged-md error **blocks** the commit (you own what you stage),
  matching the staged-card gate. Box-wide collateral is the *warn* path (Track D).
- Link resolution reads the working tree (`fs.access`), matching `--all`.

**First implementation chunk.** `listStagedMarkdown` + shared md-path predicate;
wire `collectStagedResults` to collect, lint, return `mdSummary`. Depends on B.

### Track D — box-wide broken-link warning at commit (the guardrail)

**What.** On every commit, scan the **whole box** for broken internal links and
**warn** (non-blocking). This is the `git mv` guardrail, generalized.

**Why this needs to change.** When bd40aa02 ran
`git mv notebook/valley → notebook/ashfield/valley`, the *staged* files were the
moved images/cards; the *referrer* (`saoirse.md`, unstaged, unchanged) is where the
now-broken links live. No `--staged` check — card or markdown — ever looks at
unstaged referrers. The move's damage is always in referrers, so the only check
that catches it is one that looks box-wide. Rename-detection schemes (diff
`-M`, scan old paths) have a directory-link blind spot; a full box scan has none —
it just finds every broken link, whatever caused it.

**Direction.**
- Pre-commit (`preCommitBody`, `install-validation-hooks.ts:44`) runs, in addition
  to the existing staged-card validation:
  1. **Widen the staged gate** so `bbx validate --staged` also fires on staged
     `.md` (the hook-side of Track C): `grep -E '\.(card|md)$'` replacing
     `grep '\.card$'` (`:64`).
  2. **A box-wide link warning pass** that lints every box markdown file with
     **only** CB001/CB002 and prints findings **without failing the commit**
     (exit 0). **Do not reuse `collectAllResults` (Codex #4):** it also validates
     cards, attachments, and CLAUDE.md warnings (`validate.ts:247-256`), and the
     shared `MARKDOWN_CONFIG` carries MD009/MD037/MD038/MD047 (`validate.ts:78`),
     so reusing it would neither be link-only nor non-fatal. Instead add a
     dedicated path: enumerate box markdown via `findMarkdownFiles`, run
     `markdownlint` with a config of `{ default: false, "no-view-label-links":
     true, "no-broken-internal-links": { boxRoot } }` (no MD0xx style rules), print
     findings, and `process.exit(0)` always. Surfaced as e.g. `bbx validate --links`
     (box-wide, link rules only, never fatal). Per the boxholder: it "just checks
     everything" — no rename detection, no per-move option.
- Posture is **warn, not block** (boxholder's call): a move or other multi-step
  change can leave transient breakage that the agent repairs in follow-up edits;
  blocking would trap that work. Cards staged in the same commit still block via
  the existing gate.
- Convention note (lands with Knowledge audits): a one-line note in the box's
  agent guidance — *moving box content uses `bbx mv` (it rewrites inbound links,
  including in `.md` dossiers once Track E lands); raw `git mv` on `store/**`
  leaves links dangling.* Placement decided via the `bbx-context` lens at
  implementation; default to the box CLAUDE.md.
- Re-`bbx init` `hearth-test` so it picks up the new pre-commit body.

**Note on noise.** Until the pre-existing breakage is repaired (Track F, which is
warn-and-adopt, not an active rewrite), this warning fires on those broken links
every commit. That's expected (warn, not block) — the warning *is* the mechanism
by which the breakage gets noticed and fixed.

**Performance watch-item.** A box-wide scan on every commit is `O(box markdown ×
links-per-file)` of `fs.access` calls. For `hearth-test` (~65 md files, ~510
links) that's sub-second, fine. For a large box it could become a commit-time
drag. We keep "check everything" for now (the whole point is catching breakage in
*unstaged* referrers, which a scoped scan would miss), but flag this as the first
thing to revisit if commits feel slow — likely mitigations: gate the box-wide
pass on "any staged path under `store/**`," or cache resolution results. Not done
now; recorded so the trade-off is a known dial, not a surprise.

**First implementation chunk.** The non-fatal box-wide link entrypoint
(`bbx validate --links` or equivalent) + its doctest, then the `preCommitBody`
edit + re-`bbx init`. Depends on B (needs the live, box-root-aware rule).

### Track E — `bbx mv` rewrites links in `.md` files

**What.** Extend `bbx mv`'s referrer ref-rewrite so it also rewrites links sitting
in plain `.md` dossiers, not just cards.

**Why this needs to change.** `move-operations.ts:178-216` /
`rewrite-card-refs.ts` iterate **cards** only. So a *correct* `bbx mv` of
`notebook/valley` would still have left `saoirse.md`'s image links dangling — the
"use `bbx mv`" guardrail is hollow without this. This is the durable fix that makes
moves safe going forward; Track D only *catches* breakage, Track E *prevents* it.

**Direction.**
- Extend the referrer iteration in `rewriteOtherCards`
  (`move-operations.ts:178`) — or the file-enumeration it relies on — to include
  `.md` files under the box (reusing the same `findMarkdownFiles` exclusion set),
  running the existing resolution-based `rewriteReferrerRefs`
  (`rewrite-card-refs.ts`) over them. Plain `.md` has no frontmatter to
  re-serialize, so it's the substring/resolution rewrite path. The rewrite already
  handles inline markdown links *inside cards* (`move-operations.ts:8`,
  `rewrite-card-refs.ts:17`); this widens the *file set* it applies to, not the
  rewrite semantics.
- Absolute box-root refs and relative refs in `.md` both get rewritten to the
  move's new target, the same way card body links already do.
- Naming: keep the existing function names; this widens *what files* they scan,
  not the rewrite semantics.

**First implementation chunk.** Widen the referrer file set to include `.md` +
a doctest: move a target card/dir and assert an inbound link in a sibling `.md`
dossier is rewritten. Independent of A–D (different module); sequence it before F.

### Track G — nudge agents away from raw `git mv` on store content

**What.** When the box agent runs `git mv` on a path under `store/`, inject a
non-blocking suggestion to use `bbx mv` instead.

**Why this needs to change.** Tracks D+E catch/prevent damage *after* the tool is
chosen; this steers the choice *before* the move happens, which is where the
original bug entered. `git mv` is sometimes legitimately what you want (a move
where you specifically don't want ref rewriting), so this is a suggestion, never a
block.

**Direction.**
- A **PreToolUse hook matching `Bash`** whose command contains `git mv` with an
  argument under `store/`. It injects `additionalContext` along the lines of:
  *"`git mv` on store content doesn't rewrite inbound links — `bbx mv` does
  (including links in `.md` dossiers). Prefer `bbx mv` unless you specifically want
  to move without updating references."* PreToolUse (not Post) so the agent can
  reconsider before running.
- Primary home: `src/core/sdk-hooks.ts` (the in-process Agent SDK surface the
  beebox server runs — same file as `cardValidatorHook`). Add a new
  `gitMvNudgeHook()` exporting a `PreToolUse`/`Bash` matcher; reuse the
  `additionalContext` injection shape already used there (`sdk-hooks.ts:58-63`).
- **Registration is the catch (Codex #3).** `PreToolUse` is supported by the SDK
  but is registered **nowhere** today — both callers wire only
  `hooks: { PostToolUse: [cardValidatorHook()] }` (`agent-run.ts:75`,
  `claude-chat.ts:148`). Adding a matcher in `sdk-hooks.ts` is insufficient on its
  own; both call sites must also register
  `PreToolUse: [gitMvNudgeHook()]`. Edit both.
- **Claude-Code-in-box surface.** The SDK hooks above cover the *server-run* box
  agent. A human (or agent) using Claude Code directly in the box hits the
  installed `.claude/settings.json`, not the SDK hooks. If that surface matters,
  mirror the nudge as a `PreToolUse`/`Bash` entry in the installed settings via
  `install-validation-hooks.ts` (it already manages a `PostToolUse` entry). Decide
  during implementation; don't duplicate blindly.
- Detection is a simple command-string match (`/\bgit\s+mv\b/` with a `store/`
  argument), not a full git parse. False negatives (exotic invocations) are
  acceptable for a nudge; false positives are avoided by requiring a `store/` arg.

**First implementation chunk.** The PreToolUse Bash matcher in `sdk-hooks.ts` +
a doctest asserting a `git mv store/...` command yields the suggestion and a
non-store `git mv` (or a `bbx mv`) yields nothing. Independent of A–F.

### Track F — surface the pre-existing breakage (warn-and-adopt, no scripted repair)

**What.** Make the extent of existing breakage known, then let it be repaired
through the warning (Track D) and `bbx mv` adoption (Tracks E+G) rather than a
one-time scripted rewrite.

**Why this is shaped this way.** The boxholder's call: *"we'll warn, and hope the
agent starts to use `bbx mv`."* Building active repair tooling (driving
`rewriteReferrerRefs` over inferred old→new prefix maps, or redoing each move
through `bbx mv`) is deliberately **not** done — the box-wide warning is the
mechanism that gets these noticed and fixed in the normal course of work. This
trades against *"Leave the repo clean when committing"* (`beebox/CLAUDE.md`)
— accepted explicitly: the broken links persist (as warnings) until an agent
touches those areas and repairs them with `bbx mv`.

**Direction.**
- **Size it once (read-only).** Run the fixed `bbx validate --all` (or `--links`)
  against `hearth-test` and record the full broken-link list, so the extent is
  documented and we can confirm it shrinks over time. No data is rewritten by this
  plan.
- Stale pre-move copies under
  `hearth-test/.claude/worktrees/agent-*/store/.../notebook/valley/...` are in a
  skipped dir (`SKIP_DIRS` includes `.claude`) and are worktree detritus — they
  won't appear in the scan and need no action.
- **Open: hand-fix `saoirse.md` now?** It's the user-visible symptom that started
  this. Lean: a single manual `bbx mv`-style correction of the `saoirse.md` image
  links is cheap and removes the visible breakage, without building repair tooling
  for the rest. Confirm with boxholder (see Open questions).

**First implementation chunk.** The read-only sizing run + recording the list.
Depends on A+B live.

## Subplans

None. Each track is a complete design at the first-chunk level; no sub-question
needs its own research/vocabulary decision step.

## Failure modes

**Critical gap:** none unresolved. The one that *was* critical — a content move
silently committing broken inbound links (no test, no handling, silent) — is
converted by Tracks B+D+E into a clear warning (and prevented at the source by E).

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Valid `/store/...` link false-positives after enabling (the resolve bug) | Doctest: abs-box-root-valid must NOT flag (Track A) | Track A leading-`/` → `path.join(boxRoot, rel)` | Clear |
| Rule enabled but `boxRoot` not supplied by a caller | Doctest: rule with no boxRoot **throws** | Track A required-boxRoot throw | Clear (loud failure, never wrong-but-quiet) |
| Broken relative link in an `.md` | Doctest: relative-broken must flag | Existing resolve path + onError | Clear (`Broken link: <url>`) |
| Broken box-root absolute link | Doctest: abs-box-root-broken must flag | Track A resolution + onError | Clear |
| `..`-escape link resolves to a real file *outside* the box | Doctest: out-of-box `../..` link flags even though target exists | Track A containment check (Codex #5) | Clear |
| Landmark chat session: `post.cwd` ≠ box root → valid `/store/` links false-positive | Doctest/note: `runMarkdownLint` resolves via `findBoxRoot`, not `post.cwd` | Track B `findBoxRoot(post.cwd)` (Codex #1) | Clear |
| Claude-Code-in-box `.md` hand-edit gets no write-time warning | Doctest: `runHookMode` on an `.md` with a broken link exits 2 | Track B `isMarkdownFile` branch in `runHookMode` (Codex #2) | Clear |
| Track G matcher added but `PreToolUse` never registered → nudge never fires | Covered by wiring both callers; asserted by the Track-G doctest path | Track G registers `PreToolUse` in `agent-run.ts`/`claude-chat.ts` (Codex #3) | Clear |
| `git mv` of store content leaves dangling links in an unstaged referrer | Doctest on `bbx validate --links` box-wide scan (Track D) | Track D box-wide warn at commit | Clear (warns, names referrer:line) |
| A future `bbx mv` breaks an `.md` dossier's inbound links | Doctest: bbx mv rewrites a sibling `.md` link (Track E) | Track E `.md`-aware rewrite | Clear (prevented — links rewritten) |
| Agent reaches for raw `git mv` on store content | Doctest: `git mv store/...` yields the nudge (Track G) | Track G PreToolUse Bash nudge | Clear (suggestion before the move) |
| Staged md gets no validation | Doctest: `--staged` returns non-null `mdSummary` (Track C) | Track C + grep widening (Track D) | Clear (blocks on staged md error) |
| Tag-enable accidentally turns on built-in link rules (MD011/MD051…) | Asserted via existing pass on clean files | Track B enables by name | Clear |
| Box-wide scan slows commits on a large box | N/A (perf, not correctness) | Track D performance watch-item: scope/cache if needed | Clear (degrades to slow, never wrong) |
| Pre-existing breakage persists (no scripted repair) | Sizing run records the extent (Track F) | Track D warning surfaces it; Tracks E+G drive `bbx mv` repair | Clear (visible as warnings, not silent) |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A; no new tag or field. The link *form*
  (`[label](/store/...)`) is unchanged; we only start validating it.
- **Stale ref** — **ADDRESSED.** Core case, defended in depth: Track G *steers
  away* from the raw `git mv` that causes it; Track E *prevents* it on `bbx mv`;
  Track D *catches* a ref made stale by any means as a box-wide warning; Track C
  catches an already-stale ref in a file you stage.
- **Two agents touching the same card** — N/A; the rule is a read-only validator.
- **Hand-edit drift** — **ADDRESSED** on both write-time surfaces (Codex #2): the
  server-run agent via the in-process `sdk-hooks` markdown path (Track B), and a
  Claude-Code-in-box hand-edit via the extended `runHookMode` `.md` branch (Track
  B). Plus a commit-time block if staged (Track C) and a box-wide warn otherwise
  (Track D).
- **Fabricated free-form value** — N/A; links resolve against the filesystem, so a
  fabricated path simply fails existence — honesty enforced by reality.
- **Validation error UX** — **ADDRESSED.** Errors read as
  `error  <file>:<line>  [no-broken-internal-links] … (Broken link: /store/…)`
  (`validate.ts:128-140`) and as `additionalContext` in the SDK hook
  (`sdk-hooks.ts:111-114`). Confirm the box-wide warn wording reads as advisory
  (not as a blocking error) during implementation.
- **Partial migration / transition state** — **ADDRESSED.** No data-shape
  migration; the only transition is "rule off → on," which surfaces pre-existing
  breakage at once. Track D warns (doesn't block) during that window; Track F
  sizes and repairs it before the plan completes. Engine and data land in separate
  commits.

## NOT in scope

- **App-route links in markdown** (e.g. `/dashboard`, `/browse/...`). Per the
  boxholder: a ref should point to a file or directory, not a URL/route; for now
  we **warn on anything** that doesn't resolve and see what surfaces, rather than
  building a route carve-out. If legitimate route-links turn out to live in
  markdown bodies, that's a follow-up (possibly "the whole UI is cards"), not this
  plan.
- **Blocking (vs warning) on box-wide broken links.** Considered; rejected per
  boxholder so a multi-step change can leave transient breakage and repair it.
  Staged content still blocks; box-wide is advisory.
- **Active scripted repair of existing breakage.** Considered (drive
  `rewriteReferrerRefs` over inferred prefix maps, or redo moves via `bbx mv`);
  rejected per boxholder — warn-and-adopt instead (Track F). Trades against "leave
  the repo clean"; accepted explicitly.
- **Blocking the agent's `git mv`.** Track G *suggests* `bbx mv`, never blocks —
  `git mv` is sometimes legitimately what's wanted (a move without ref rewriting).
- **Query-string (`?…`) handling in link URLs.** The rule splits on `#` only;
  `?`-bearing internal links are vanishingly rare in box content. Left as-is.
- **Other boxes' data.** The engine fixes (A–E) benefit every box; only
  `hearth-test`'s data is repaired here (Track F).
- **Backfilling a guardrail against non-rename link rot** (deleting a target file
  without `bbx rm`). The box-wide warn (Track D) actually catches this too as a
  side effect, but no dedicated handling is added.

## Open design questions

- **Track F: hand-fix `saoirse.md` now, or leave it to warn-and-adopt?** It's the
  user-visible symptom that started this. Lean: do the single manual `bbx mv`-style
  correction (cheap, removes the visible breakage) while leaving the rest to the
  warning. Boxholder said "warn and hope," which may mean leave even saoirse — confirm.
- **Track G registration surface.** Whether the box agent's Bash calls flow
  through `sdk-hooks` only, or also the box's installed `.claude/settings.json`.
  Decided by a quick check at implementation, not a design fork — mirror into the
  installed settings hook only if that surface is real for box agents.
- **Track D entrypoint surface.** A `bbx validate --links` flag (box-wide, custom
  link rules only, always exit 0) is the concrete shape — settle the exact flag
  name when wiring; not a design fork. (Resolved away: no rename-detection option —
  "just check everything" means the scan is unconditional and box-wide.)

## Knowledge audits

Two agent-facing conventions, so two audits land with the plan
(`src/dev/knowledge-audits.yaml`, format per `:1-40`):

- `move-store-content-uses-bbx-mv` — prompt: *"How do you move or rename content
  under `store/`?"*; `expected_level: knows_directly`;
  `watch_for: "Names bbx mv and that it rewrites inbound links (incl. .md dossiers); warns against raw git mv"`;
  `correct_contains: ["bbx mv"]`; `tags: [navigation, links]`.
- `internal-links-resolve-to-box-root` — prompt: *"A markdown link is
  `[x](/store/foo/bar.md)`. What does the leading slash mean?"*;
  `expected_level: knows_directly`;
  `watch_for: "Box root, not OS root; must point to an existing file/dir"`;
  `correct_contains: ["box root"]`; `tags: [links]`.

Both land **run**, not just written:
`pnpm knowledge-audit run --box <absolute-path-to-hearth-test> --filter links`
(absolute path per the `knowledge-audit --box is a path` memory — never a nested
in-repo path), status comment recorded in `knowledge-audits.yaml` before the plan
completes.

## Implementation order

1. **Track A** — rule reads `boxRoot` from `params.config` (required, throws if
   absent), leading-`/` resolves to box root, description updated. (Commit.)
2. **Track B** — enable CB001/CB002 by name in both configs; thread `boxRoot`
   through `lintMarkdownFiles` and `runMarkdownLint`. (Commit.) — depends on A.
3. **Track C** — `listStagedMarkdown` + shared md-path predicate;
   `collectStagedResults` returns a real `mdSummary`. (Commit.) — depends on B.
4. **Track D** — non-fatal box-wide `bbx validate --links` entrypoint + doctest;
   `preCommitBody` widens grep to `.(card|md)$` and adds the warn pass; box
   convention note; re-`bbx init` hearth-test. (Commit.) — depends on B.
5. **Track E** — widen `bbx mv`'s referrer scan to `.md` + doctest. (Commit.) —
   independent of A–D.
6. **Track G** — PreToolUse Bash nudge away from `git mv` on store content +
   doctest. (Commit.) — independent of A–F.
7. **Doctests for A–E, G** land with their tracks (named in Rollout). (Same commits.)
8. **Knowledge audits** written + run. (Commit.) — after B/D/E/G conventions exist.
9. **Track F** — read-only sizing run, record the breakage list; optional manual
   `saoirse.md` fix pending boxholder. (Commit.) — depends on A+B live. **No scripted
   repair; separate from the engine commits.**

Engine (1–8) is the unit that proves correct against tests; F (9) is the
read-only sizing + optional symptom fix. The plan completes when these are done;
nothing merges to main until the boxholder asks.

## Rollout shape

- **Test posture.** A doctest file for the rule (none exists today; `grep` found
  no coverage of `noBrokenInternalLinks`), asserting as a design tool:
  (1) relative-broken **flags**, (2) abs-box-root-valid **does not flag**,
  (3) abs-box-root-broken **flags**, (4) rule-without-boxRoot **throws**. Plus:
  a `--staged` doctest (staged `.md` → non-null `mdSummary`, Track C); a box-wide
  `--links` doctest (an unstaged referrer with a broken link is reported but exit
  is 0, Track D); a `bbx mv` doctest (moving a target rewrites a sibling `.md`
  link, Track E); a Track-G doctest (`git mv store/...` → nudge; non-store `git
  mv` / `bbx mv` → silence). Plus the Codex-surfaced cases: an out-of-box `../..`
  link flags despite the target existing (containment, #5), and `runHookMode` on
  an `.md` with a broken link exits 2 (#2). These encode the Failure-modes
  "Test exists?" column. Per `docs/testing.md`, cover the substantial codepaths,
  not every line.
- **Knowledge-audit entries.** Both land with the plan, run and status-commented
  (above). None deferred.
- **Migration approach.** No card data-shape change, so no schema migrator. No
  scripted data repair either (Track F is warn-and-adopt): the only data action is
  a read-only sizing run plus an optional manual `saoirse.md` fix. Re-`bbx init` on
  `hearth-test` reinstalls the new pre-commit body (Track D) and, if mirrored
  there, the `git mv` nudge (Track G).

## Cross-model review (Codex)

An adversarial read by OpenAI's `codex` (read-only against real source)
verified the central mechanism and surfaced five correctness refinements, all
folded in above:

- **#1 (folded, Track B)** — don't derive box root from `post.cwd`; landmark chat
  sessions set `cwd` to a subdir (`chat-session-start.ts:106`). Resolve via
  `findBoxRoot(post.cwd)`.
- **#2 (folded, Track B)** — the installed shell hook `bbx validate --hook`
  (`runHookMode`) exits for non-card markdown (`validate.ts:192`), so
  Claude-Code-in-box `.md` edits got no warning. Added an `isMarkdownFile` branch.
- **#3 (folded, Track G)** — `PreToolUse` is registered nowhere today
  (`agent-run.ts:75`, `claude-chat.ts:148` wire only `PostToolUse`); the nudge
  needs both callers to register it, not just a new matcher.
- **#4 (folded, Track D)** — the box-wide warn can't reuse `collectAllResults`
  (validates cards/attach/CLAUDE.md and runs MD0xx); needs a dedicated link-only,
  always-exit-0 path.
- **#5 (folded, Track A)** — add box-containment so a `..`-escape to a real
  outside file is flagged, not passed.
- **Verified OK** — object-valued markdownlint rule config both enables the rule
  and passes the object as `params.config` (`markdownlint.mjs:301`/`:599`); async
  custom rules supported. The Track-A/B mechanism is sound.
- **#6 (considered, kept)** — Codex flagged Track G + knowledge audits as beyond
  the correctness core. Kept deliberately: the `git mv` nudge is a boxholder-
  requested guardrail and per-concept audits are a `bbx-plan` requirement. Codex's
  point stands only as *priority order* — the correctness core (A/B + root
  plumbing + hook parity + staged md + `.md` referrer enumeration) lands first,
  which the Implementation order already reflects.
- **Citations corrected** — `rewrite-card-refs.ts` is at `src/core/` (not
  `src/core/commands/`); the inline-markdown-link anticipation is at
  `move-operations.ts:8` / `rewrite-card-refs.ts:17`, not `:151-155`.

## Implementation notes (as built)

Landed across 8 commits on `worktree-fix-link-validation` (Tracks A→B→C→D→E→G,
then guide+audits, then sizing). Deviations and findings worth recording:

- **New module `cli/commands/validate-markdown.ts`.** `validate.ts` hit its
  300-line limit, and Tracks C/D needed a shared home for markdown linting. Holds
  `lintMarkdownFiles`, `boxWideLinkWarnings`, `isLintableMarkdown`,
  `listStagedMarkdown`, `formatMarkdownResults`.
- **Box-markdown discovery consolidated in `core/list-cards.ts`
  (`listBoxMarkdownFiles`).** Track E needed `core/move-operations.ts` to
  enumerate `.md`, and `core` must not import from `cli`. One glob-based source of
  truth now serves validate (cli) and move (core); replaced the earlier fs-walk.
- **Generated/ephemeral dirs skipped** (`docs/generated/`, `.beebox/`).
  Surfaced during Track D: `docs/generated/` (gitignored, regenerated) is full of
  placeholder example links and flooded the warning with 22 false positives on
  test1. The box scan skips it; staged collection never sees it (gitignored ⇒
  unstageable).
- **Known false-positive class: links inside inline-code spans.** The rule is
  regex-based (`parser: "none"`), so `` `[text](url)` `` in authored prose (a spec
  doc, a how-to) is flagged like a real link. Bounded by warn-only posture;
  fixing it needs markdown-aware parsing (deferred).
- **Track F sizing (read-only, no scripted repair per boxholder):**
  `bbx validate --links` on `hearth-test` → **207 broken links / 33 files**.
  ~123 from the four `ashfield/` moves (porthaven 43, island 38, stonebridge 28, valley
  14 — dossiers pointing at pre-move `/store/.../notebook/<X>/images/...`); the
  rest pre-existing breakage in `greenhollow/` and `convent/` dossiers (NOT from
  the ashfield moves — bigger than the briefing assumed) plus example-link false
  positives in a spec doc. Left to warn-and-adopt.
- **Knowledge audits:** both pass against test1 (`knows_directly`, 0 reads).
