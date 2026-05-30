# ESLint rule-suppression audit

**Status:** in progress — ratchet landed; bare-catch rule burned down (backend)
**Found:** 2026-05-30, during the `fix-cb-mv` worktree (a tangent off the `cb mv` work)
**Scope:** `callback-box` (backend + frontend) and `cardworks`

## Progress log

- **2026-05-30 — ratchet landed (backend).** Removed the off-block from
  `callback-box/eslint.config.mjs`; captured existing debt in committed
  `eslint-suppressions.json` (1000 violations) via `eslint --suppress-all`;
  added `--pass-on-unpruned-suppressions` to the backend lint-staged command;
  kept `custom/jsx-classname-required` off with a comment. All rules now
  enforced for new/touched code.
- **2026-05-30 — `no-restricted-syntax` bare-catch burned down (backend).** All
  270 bare `catch {}` bound and made non-silent (log / rethrow / inspect /
  justified-`_e`), then ENOENT-guarded so normal file-absence doesn't spam
  output. Suppressions pruned 1000 → 730. **0 bare catches remain.**
- **2026-05-30 — `default/no-default-params` (30) + `security/detect-non-literal-regexp` (3) burned down (backend).** Defaults hoisted into bodies (`x?: T` + `x = x ?? default;`). The 3 dynamic regexes are reviewed-safe (escaped glob / hardcoded keys) and got documented inline `eslint-disable` lines rather than living in suppressions.
- **2026-05-30 — `error/*` family burned down (backend, all 4 rules → 0).** 234 violations across 52 files. One reusable `NotFoundError(id, resource)` in `src/lib/errors.ts` covers the 15 "X not found" sites; ~60 local purpose-named classes cover the bespoke conditions (message composed inside the class, dynamic data as fields). Key constraints discovered: the `error/*` rules flag a string/template literal only in the **first** constructor arg, so reusable classes pass the label as a non-first arg; and `error/no-throw-literal` rejects re-throwing a caught `unknown` — fixed with a behavior-preserving `throw e as Error` at 29 inspect-and-rethrow sites. Existing message-carrying classes (e.g. `CardIOError`) were refactored to compose from a leading structured field rather than split into micro-classes.
- **2026-05-30 — `no-optional-chaining` RETIRED (not burned down).** Reviewed the
  302 sites on real code: optional chaining + `??` reads clearly and forcing
  explicit null checks made nested chains (`x?.[0]?.y`, `find()?.z`) worse. The
  maintainer decided the rule isn't earning its keep, so it was disabled at the
  source — `personal-vibe-check` (bumped to 0.2.0, off via a global config entry
  so it also covers `.tsx` under `react:false`, which `disabledRules` doesn't
  reach). Removed the now-redundant frontend override and the "No optional
  chaining" bullet from CODE-STYLE.md + vibe-check CONVENTIONS/README. Pruned all
  302 backend suppressions. (vibe-check's own dev deps aren't installed in this
  worktree, so its self-tests weren't re-run; the change is config-only and both
  callback-box halves lint clean against it.)
- **2026-05-30 — `??` ban retired, `as` ban kept (`.tsx` no-restricted-syntax).**
  Reviewed the 72 `.tsx`-only sites. The ~44 `??` bans were clean default idioms
  (`options.x ?? default`) — inconsistent with allowing optional chaining — so the
  nullish selector was removed from personal-vibe-check (0.2.0 → 0.3.0) for the
  `react:false` `.tsx` path; pruned its 44 suppressions. The `as`-cast ban (27,
  all parse-boundary casts in `guide.tsx`) is **kept** — `as` is treated like
  Rust's `unsafe`: allowed only when guarded by a justifying comment or
  centralized in one typed helper (documented in CODE-STYLE.md / CONVENTIONS.md).
  Those 27 `as` + 1 default-switch remain as debt; the `as` cluster will dissolve
  when `guide.tsx` is split into typed parse helpers during the structural pass.
- **2026-05-30 — bare-catch rule enabled for the frontend.** In the frontend
  (`react: true`), `no-restricted-syntax` carries *only* the bare-catch selector
  (no `??`/`as`/switch), so enabling it surfaced exactly 14 bare catches across
  11 files. All fixed by hand (SSE-parse → `console.debug`, discrete fetch
  failures → `console.warn`, justified swallows like already-revoked object URLs
  / mutation errors already shown in the UI → bound `_e` + comment). Rule lands
  **fully clean — no suppressions needed.** The frontend's other off-block rules
  (optional-chaining, error/*, max-lines*, default-params) remain off and are a
  separate burn-down.

### Two corrections to this doc's original numbers

- The "6 rules re-enable for free" (below) is really **2**:
  `security/detect-bidi-characters` and `@typescript-eslint/no-this-alias`. The
  other four (`detect-object-injection`, `no-hardcoded-urls`, `single-export`,
  `require-spec-file`) are disabled in vibe-check's *own* preset for `.ts`
  files — removing callback-box's override doesn't enable them. "0 violations"
  masked "rule off." (They *are* on for `.tsx`, where they happen to have 0
  hits.)
- `no-restricted-syntax` (342) is **not** homogeneous. It's **270 bare catches**
  (`.ts` files, one selector) + **72 in `.tsx`** files, whose strict config gives
  the rule a different selector set: `??` nullish-coalescing (44), `as`
  assertions (27), default switch case (1). The 270 are done; the 72 `.tsx`
  `??`/`as` items remain suppressed and are a separate burn-down.

## TL;DR

When `@ianbicking/personal-vibe-check` was integrated (2026-02-14), each
project's `eslint.config.mjs` was given a block that turns **18 rules off**.
Several of those are rules from personal-vibe-check itself (i.e. rules we
deliberately authored), and several directly contradict the written rules in
`callback-box/CODE-STYLE.md`. The suppression has been silent ever since — the
preset says "enforce these," the project config says "never mind."

This is **not** ongoing/creeping suppression: the block was added once, at
integration, and has been essentially static since (one later edit only added
`**/*.mjs` to the ignore list). But it means our lint has never actually
enforced a chunk of our own style.

Re-enabling everything surfaces a large existing-debt backlog
(**~1009** violations in the backend alone, **0** of them auto-fixable), so the
fix is a policy/ratchet decision, not a quick edit.

## How this was disabled (forensics)

`callback-box/eslint.config.mjs` has been touched by exactly two commits:

| Commit | Date | What it did |
|---|---|---|
| `1efb334c` | 2026-02-14 | "Integrate personal-vibe-check…" — **added the entire 18-rule `off` block.** Co-authored by Claude Opus 4.6. |
| `f27f6773` | 2026-03-05 | "Add session viewer…" — only added `"**/*.mjs"` to the `ignores` list (to skip loader-shim files). Disabled no rules. |

So the disabling was a single deliberate act at adoption time — the common
"turn off whatever would mass-fail so the new preset can land" move — done by an
agent under the maintainer's name. It was never separately reviewed/approved as
a policy decision. `cardworks` and `callback-box/src/frontend` carry the same
block (added with their own vibe-check integrations).

## What's disabled, by project

Legend for **Owner**: `vibe` = a personal-vibe-check rule we wrote · `core` =
ESLint core · `3p` = bundled third-party plugin.
**Style?** = does it contradict `callback-box/CODE-STYLE.md`.

### callback-box backend (`eslint.config.mjs`) — ~1009 violations if restored

| Rule | Owner | Style? | Violations |
|---|---|---|---:|
| `no-restricted-syntax` | core | – | 342 |
| `no-optional-chaining/no-optional-chaining` | vibe | **yes** ("No optional chaining") | 302 |
| `error/no-literal-error-message` | vibe | ~ (custom-error policy) | 76 |
| `error/no-generic-error` | vibe | **yes** ("custom error classes") | 53 |
| `error/require-custom-error` | vibe | **yes** ("custom error classes") | 53 |
| `error/no-throw-literal` | vibe | **yes** ("never throw literals") | 52 |
| `max-lines` | core | **yes** ("files max 300 lines") | 36 |
| `default/no-default-params` | vibe | **yes** ("No default parameters") | 30 |
| `complexity` | core | – | 27 |
| `max-lines-per-function` | core | **yes** ("functions max 150") | 26 |
| `custom/jsx-classname-required` | vibe | – | 9 |
| `security/detect-non-literal-regexp` | 3p | – | 3 |
| `default/no-hardcoded-urls` | vibe | – | **0** |
| `single-export/single-export` | vibe | ~ ("only export what's needed") | **0** |
| `ddd/require-spec-file` | vibe | – | **0** |
| `security/detect-object-injection` | 3p | – | **0** |
| `security/detect-bidi-characters` | 3p | – | **0** |
| `@typescript-eslint/no-this-alias` | 3p | – | **0** |

**6 rules have zero current violations** and can be re-enabled for free,
immediately, with no debt: `no-hardcoded-urls`, `single-export`,
`require-spec-file`, `detect-object-injection`, `detect-bidi-characters`,
`no-this-alias`.

### callback-box frontend (`src/frontend/eslint.config.mjs`) — ~401 violations

Disables the same family (minus `error/no-throw-literal`, `complexity`, the
`security/*` set, `no-this-alias`; it keeps those **on**). Also disables
`react-hooks/set-state-in-effect` — but that one has an in-file comment
explaining a real reason (legit, leave it). Dominant debt:

| Rule | Violations |
|---|---:|
| `no-optional-chaining/no-optional-chaining` | 127 |
| `default/no-default-params` | 97 |
| `error/no-generic-error` | 52 |
| `error/require-custom-error` | 52 |
| `error/no-literal-error-message` | 39 |
| `no-restricted-syntax` | 14 |
| `max-lines` | 10 |
| `max-lines-per-function` | 8 |

### cardworks (`eslint.config.mjs`) — ~117 violations (APPROXIMATE)

Same family of disables. **These numbers are rough**: the audit method
(running the bare preset) re-enabled rules cardworks legitimately keeps on
(`max-params`, several `unicorn/*`) and hit a couple of parser-config
differences, so the tally is polluted. Treat as "order of magnitude, dominated
by `default/no-default-params`, `error/*`, `no-restricted-syntax`,
`no-optional-chaining`." Re-run with cardworks' real config minus the off-block
for exact figures before acting.

## Why it matters

The point of personal-vibe-check is that every rule is a deliberate choice.
Disabling them globally — especially the `error/*`, `no-optional-chaining`,
`no-default-params`, and `max-lines*` rules that `CODE-STYLE.md` *also* states
in prose — means:

- New code can freely use the patterns we say we don't use; nothing flags it.
- `CODE-STYLE.md` is lying: it documents rules that aren't enforced.
- Agents reading `CODE-STYLE.md` follow it; agents inferring style from lint
  output do not — inconsistent behavior depending on which signal they trust.

## The debt is not auto-fixable

`0 / 1009` backend violations have an ESLint autofix. So "re-enable + `--fix`"
does nothing; every violation is a manual edit:

- `no-optional-chaining` (302 + 127): replace `a?.b` with explicit null checks.
- `error/*` (≈234 backend, ≈143 frontend): wrap `throw new Error(...)` in custom
  error classes / typed errors.
- `no-restricted-syntax` (342 + 14): depends what's restricted — inspect the
  rule config; may be one or two dominant patterns.
- `max-lines*` / `complexity` (≈89 backend): structural refactors (file/function
  splits). `move.ts` — the file that kicked this off — is one of them.
- `default/no-default-params` (30 + 97): hoist defaults into the body.

## Recommended remediation: ratchet via native suppressions

ESLint 9.39 (what we run) has a built-in baseline feature — the clean way to
turn the rules **on now** without a 1009-line diff or staying-disabled:

1. Remove the `off` block from each `eslint.config.mjs` (keep the deliberate
   keepers: the frontend `react-hooks/set-state-in-effect` comment-justified
   disable, the `max-params: 2` setting, the path `ignores`).
2. `npx eslint src/ --suppress-all` → writes `eslint-suppressions.json`, a
   committed, per-file/per-rule, **counted** record of existing violations.
3. Commit config + suppressions file. From here:
   - Rules are **enforced** for all new and touched code.
   - Existing violations are individually cataloged (visible in the repo), not
     hidden behind a global `off`.
   - `eslint --prune-suppressions` shows progress as debt is paid; the file only
     shrinks.
4. The 6 zero-debt backend rules need no suppression entries — instantly live.

This is the standard "stop the bleeding, ratchet down" pattern and keeps the
build green. It is reversible and low-risk.

**Verify before committing:** confirm the pre-commit path works with the
baseline. `lint-staged` runs `eslint` on a *subset* of staged files; check that
suppressions for unlinted files don't trip "unused suppression" failures (may
need `--pass-on-unpruned-suppressions` on the lint-staged eslint invocation).

### Alternative: actually fix the debt

Pay down all ~1500 violations across the three projects. Correct end state but a
multi-day, multi-file effort with real regression risk (esp. the 429
optional-chaining rewrites and the error-class migrations). Best done
rule-by-rule, each as its own reviewed PR, *after* the ratchet is in place so no
new debt accrues meanwhile.

## Coordination — why this needs a quiet tree

There are **6 other active worktrees** right now:

```
worktree-a11y-browse, worktree-commetary, worktree-diarization,
worktree-markdoc-direct-quotes, worktree-update-stack-decisions, (+ this one)
```

Implications for sequencing:

- **Ratchet approach** touches only `eslint.config.mjs` + a new
  `eslint-suppressions.json` per project — **near-zero merge conflict** with
  feature branches. Safe to land anytime. But note: once it lands on `main`,
  every *other* worktree that merges main will start having its newly-written
  code linted against the restored rules — so land it when in-flight branches
  are at a checkpoint, and give a heads-up.
- **Full-fix approach** edits hundreds of files (every `?.`, every `throw`,
  several file splits) — **high conflict** with anything in flight. Do not start
  this while the other six worktrees have uncommitted/unmerged work in the same
  files. Coordinate a freeze or sequence it last.

Recommended order: (1) land the ratchet on a quiet `main`, announce it; (2) burn
down debt rule-by-rule in dedicated PRs; (3) once a rule's suppressions hit
zero, it's just a normal enforced rule.

## Decisions needed

1. Ratchet now, or full-fix? (Recommend: ratchet now, fix incrementally.)
2. All three projects in one pass, or callback-box first?
3. Any disabled rule we actually want to *stay* off deliberately (e.g. the noisy
   `security/detect-object-injection`)? If so, keep it off **with a comment**
   saying why — the problem isn't that things are disabled, it's that they're
   disabled silently and against documented policy.
4. Re-run the cardworks audit with its real config for exact numbers before
   touching it.

## Appendix: reproduce the audit

Per project, temporarily drop the `off` block (keep `ignores` and other
keepers), then:

```bash
npx eslint src/ -c eslint.audit.mjs --format json \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const f=JSON.parse(d);const t={};for(const x of f)for(const m of x.messages){const r=m.ruleId||"(parse)";t[r]=(t[r]||0)+1;}for(const[r,n]of Object.entries(t).sort((a,b)=>b[1]-a[1]))console.log(String(n).padStart(5),r);});'
```

(`eslint.audit.mjs` = the project's real config with the `off` rules removed.
Delete it afterward — it is not committed.)
