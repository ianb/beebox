# /review + /ship + /land-and-deploy

Three skills that form gstack's shipping pipeline. Reading them as a set because the boundaries between them are deliberate and worth understanding.

## The split

| Skill | What it does | When |
|---|---|---|
| **/review** | Read-only diff analysis. Outputs findings + auto-fixes. Doesn't touch git history, doesn't push, doesn't create PRs. | Standalone, before /ship. The "analysis engine." |
| **/ship** | 20-step pre-merge ritual. Runs tests, an embedded /review-like flow, version bump, CHANGELOG, TODOS update, bisectable commits, doc sync subagent, create PR. | When you're ready to land work. Eats /review's job if it wasn't already run. |
| **/land-and-deploy** | Picks up where /ship left off. Merges PR, waits for CI, polls deploy workflow, runs canary on production URL, offers revert if unhealthy. | After /ship. The "release engineer" persona. |

So the question "what's the difference between /ship and /review?" answers: **/review is one stage of /ship.** You can run /review standalone for a code review pass. /ship runs that same analysis internally (Step 9, "Pre-Landing Review") plus everything else needed to actually land the code.

## /review — the analysis engine

Twelve+ steps. The interesting bits:

### Scope Drift Detection (Step 1.5)
> "Did they build what was requested — nothing more, nothing less?"

Reads `TODOS.md`, PR body, commit messages → derives **stated intent**. Diff stat → derives **delivered**. Then:
- **SCOPE CREEP** — files changed unrelated to intent, "while I was in there..." expansions
- **MISSING REQUIREMENTS** — TODOS items not addressed, partial implementations

Informational, doesn't block. **Worth borrowing for callback.** Cheap way to catch "I asked for X, you did X+Y+Z+W."

### Confidence Calibration (Step 4)
Every finding has a 1-10 confidence score with explicit display rules:

| Score | Meaning | Display |
|---|---|---|
| 9-10 | Verified by reading specific code | Show normally |
| 7-8 | High confidence pattern match | Show normally |
| 5-6 | Moderate — could be a false positive | Show with caveat |
| 3-4 | Pattern suspicious but may be fine | Appendix only |
| 1-2 | Speculation | Only if P0 |

**The pre-emit verification gate** (the killer mechanic):
> "Before any finding is promoted to the report, the gate requires: **quote the specific code line that motivates the finding** — file:line plus the verbatim text. If you can't quote it, the finding is unverified. Force its confidence to 4-5."

Kills entire false-positive classes by construction:
- "field doesn't exist on model" → must quote the model class body
- "dict.get() might be None" → must quote the dict initialization
- "race condition between A and B" → must quote both A and B

"Rationalization prevention: 'This looks fine' is not a finding. Either cite evidence it IS fine, or flag it as unverified."

**This is excellent.** Worth borrowing as a general AI-review principle: *no finding ships unless the agent quotes the line motivating it.*

### Review Army — Specialist Dispatch (Step 4.5)
Detect stack (Gemfile/package.json/go.mod/etc.) and scope signals (frontend/backend/auth/migrations/API). Then dispatch specialists in parallel as subagents.

Always-on (>=50 LOC): **testing**, **maintainability**
Conditional: **security** (auth or backend+100LOC), **performance** (backend or frontend), **data-migration** (migrations), **api-contract** (API), **design** (frontend), **red-team** (>200 LOC or any critical finding)

Specialists get fresh subagent context — no review bias. Each outputs JSON-per-line for structured collection.

**Adaptive gating** — `gstack-specialist-stats` tracks each specialist's hit rate. If a specialist has 0 findings in 10+ dispatches → tagged `GATE_CANDIDATE`, auto-skipped. Some specialists tagged `NEVER_GATE` (security, data-migration) — they always run as insurance.

**Multi-specialist confirmation** — same fingerprint (`path:line:category`) from multiple specialists → boost confidence by +1, tag as MULTI-SPECIALIST CONFIRMED.

**Red Team subagent** runs after the others, gets the merged findings as input, and is told to find what they MISSED. "Focus on cross-cutting concerns, integration boundary issues, and failure modes that specialist checklists don't cover."

### Fix-First (Step 5)
Every finding gets action, not just criticals.

- **AUTO-FIX** items are applied directly with one-line summaries
- **ASK** items are batched into a single AskUserQuestion with numbered list + recommendation
- **Test stub override** — if a specialist generated a `test_stub`, force-classify as ASK so user sees the proposed test code and can approve fix+test together

### Cross-review finding dedup (Step 5.0)
If a finding was previously `skipped` by the user AND its file hasn't changed since → suppress this time. Only suppresses `skipped`, never `fixed` or `auto-fixed` (those might regress and should be re-checked).

**Generalizable.** Memoize user decisions. "You said no to this last time; I won't re-ask unless the relevant code changed."

### Verification of claims (Step 5)
> "If you claim 'this pattern is safe' → cite the specific line proving safety. If you claim 'this is handled elsewhere' → read and cite the handling code. If you claim 'tests cover this' → name the test file and method. Never say 'likely handled' or 'probably tested' — verify or flag as unknown."

Same anti-rationalization discipline as the confidence gate, applied to claims of safety instead of claims of bugs.

## /ship — the 20-step landing ritual

The interesting structural bits beyond what /review already does:

### Review Readiness Dashboard (Step 1)
Reads `gstack-review-read` (prior review JSONL within 7 days). Renders a status table of which reviews have run — Eng / CEO / Design / Adversarial / Outside Voice — with staleness detection (compares stored commit hash to current HEAD, counts elapsed commits).

**Only Eng Review gates shipping.** CEO and Design are informational reminders. Adversarial is always-on automatic. Outside Voice (Codex on the plan) never blocks.

### Distribution Pipeline Check (Step 2)
If diff adds new artifact (`cmd/.../main.go`, `bin/`, new package), check for a release workflow. If artifact added but no release workflow → ask: add workflow now, defer to TODOS, or "internal/not needed".

Cute thing to catch — easy to forget the publish step when adding a new CLI.

### Merge base branch BEFORE tests (Step 3)
> "Fetch and merge the base branch into the feature branch so tests run against the merged state."

Auto-resolves simple conflicts (VERSION, schema.rb, CHANGELOG ordering). Tests run against what will actually be on the base branch after merge, not against your possibly-stale branch.

**Subtle but right.** Catches "passes on my branch, breaks on main."

### Always-on Adversarial Review (Step 11)
> "Every diff gets adversarial review from both Claude and Codex. LOC is not a proxy for risk — a 5-line auth change can be critical."

Both run as standard. Adds a Codex *structured* review only for 200+ line diffs.

Same forced synthesis line as /codex challenge mode:
> "End your output with ONE line in the canonical format `Recommendation: <action> because <one-line reason naming the most exploitable finding>`."

### Bisectable commit chunks (Step 15)
Doesn't just commit everything as one. Splits into bisectable logical chunks. (Didn't read the detail but the framing is right — each commit should build + pass tests.)

### Doc sync subagent BEFORE PR creation (Step 18)
Spawns a subagent to sync READMEs/CHANGELOG/docs based on the diff, before opening the PR. So the PR opens with docs already updated.

## /land-and-deploy — the release engineer

This one leans more on persona and voice than mechanics. The bones:

### "Release Engineer" persona
> "You are a Release Engineer who has deployed to production thousands of times. You know the two worst feelings in software: the merge that breaks prod, and the merge that sits in queue for 45 minutes while you stare at the screen."

Voice rules: narrate what's happening now, explain why before asking, be specific not generic ("Your Fly.io app 'myapp' is healthy" not "deploy looks good"), acknowledge the stakes, **first-run = teacher mode** (walk through everything), **subsequent runs = efficient mode** (brief status).

### First-run dry-run validation (Step 1.5)
If no `~/.gstack/projects/$SLUG/land-deploy-confirmed` marker → dry-run walkthrough first. Also hashes the `## Deploy Configuration` section of CLAUDE.md + relevant workflow files; if changed since confirmation, re-validate.

**Worth borrowing.** Pattern: "this skill is destructive, the first run is a dry-run; mark the project as confirmed; re-validate when the relevant config hashes change."

### Persisted deploy config in CLAUDE.md
Looks for `## Deploy Configuration` section in CLAUDE.md to get production URL + platform. Falls back to auto-detection from config files (fly.toml / render.yaml / vercel.json / netlify.toml / Procfile / railway.json).

### Scope-based deploy skipping
Uses `gstack-diff-scope` to check `SCOPE_DOCS`/`SCOPE_FRONTEND`/`SCOPE_BACKEND`/`SCOPE_CONFIG`. If only docs changed → skip verification entirely. "This was a docs-only change — nothing to deploy or verify. You're all set."

### Staging-first option
If staging environment detected and changes include code, offer:
- A) staging first, verify, then production (Completeness: 10/10)
- B) skip staging, straight to production (Completeness: 7/10)
- C) staging only, check production later (Completeness: 8/10)

Runs Steps 6-7 against staging, then runs them again against production if A.

### Revert on canary failure
If canary detects production health issues post-deploy, offers revert as an explicit option.

## Ideas worth absorbing (regardless of whether we adopt these skills)

1. **Pre-emit verification gate** for any AI-generated finding: must quote the motivating line, or the finding is unverified and downgraded. Kills entire FP classes by construction. Same discipline applies to *claims of safety* ("this is handled elsewhere" → cite the line).
2. **Confidence as a first-class field with display rules** — not a free-form qualifier in prose, a 1-10 number with explicit show/caveat/appendix/suppress thresholds.
3. **Cross-review skip memoization** — remember which findings the user dismissed, suppress them next time unless the file changed.
4. **Specialist dispatch with adaptive gating** — parallel subagents per domain, fingerprint dedup, hit-rate-based auto-skipping with `NEVER_GATE` exceptions for insurance specialists.
5. **Red team after specialists** — final subagent receives the merged findings and is told to find what was missed. Different cognitive task than "review the diff."
6. **Scope drift check** — explicit "stated intent vs delivered" comparison as its own step.
7. **Review Readiness Dashboard** — separate concept of "which review ran when, against what commit, how stale" — with the rule that *only one review actually gates shipping.* The rest are advisory.
8. **Merge base BEFORE tests** — run tests against the merged state, not the branch tip.
9. **Bisectable commit chunking** — single feature ships as multiple atomic commits each of which builds.
10. **First-run dry-run + hash-detect re-validation** — destructive skills earn trust per-project, re-prompt when config changes.
11. **Persona-driven voice** — /land-and-deploy's "Release Engineer who has deployed thousands of times" framing reads very differently from /review's clinical bug-finder. Worth experimenting with for skills where the tone changes how the user receives the output.
12. **Mode-switch on first run** — teacher mode (walk through everything, explain) vs efficient mode (status updates only). Tracked by a marker file.

## Cost to adopt /review specifically

The specialist files (`review/specialists/*.md`) are the most adoptable piece — each is a focused checklist for one domain. We could vendor those directly and skip the orchestration logic. They're maintained, language-aware, and would compose with our existing Claude Code skills.

Heavier pieces (review-readiness dashboard, gstack-specialist-stats binary, gstack-review-read JSONL store, gstack-diff-scope) are gstack-internal and would need re-implementation or replacement.

## Ian's take

**On density.** The whole pipeline is too dense and large to absorb directly. Not clear how to engage with it as a unit. Treat as a mining target — pull individual ideas, leave the rest.

**Pre-emit verification gate — yes, conceptually.** The citation discipline (must quote the line motivating a finding; "this is handled elsewhere" must cite the handling line) is the right kind of rule. It targets the actual failure mode (AI asserting bugs without reading the code).

**Confidence levels — no.** Numeric confidence (1-10) is the wrong framing for what I want. I'd rather:
1. Explain to the AI WHY certain checks matter (the underlying reasoning, the failure mode they catch)
2. Have the AI analyze the code and **explain in prose why it believes the proposed action is correct**

The reasoning lives in the explanation, not in a separate number that has to be calibrated against thresholds. A finding that comes with a clear "I think this is a SQL injection because the string interpolation at line 42 puts unsanitized `params[:name]` directly into the query — I checked upstream callers and none sanitize" carries more information than the same finding with `confidence: 9/10`.

This is compatible with the verification gate — citation + reasoning prose can stand in for citation + numeric score.

**Red Team — interesting.** A subagent that gets the prior findings and is told "find what was missed" is a different cognitive task than "review the diff." The framing acknowledges that any single review pass has blind spots, and the right response is another pass aimed at the gaps, not more thoroughness in the same pass.

**Not pursuing wholesale adoption.** The specialist checklists and a few mechanics (verification gate, scope drift, red team) are the parts worth keeping.

## The form-as-prompt pattern (Ian's preferred shape)

Better than either numeric confidence OR free prose: a **structured template** that:

1. **Has carefully explained criteria** for each field — the criteria explanations teach both the AI and any human reader why each check matters.
2. **The agent fills in the form** — each field is addressed explicitly, not glossed.
3. **The combined form+prompt becomes a reference document** — readable, scannable, attachable, forwardable to a teammate.
4. **Composes** — the form is a spec you can evolve, version, build on, or pass on.

Concretely, instead of:
> `[P1] (confidence: 9/10) app/models/user.rb:42 — SQL injection via string interpolation`

You'd have something like:

```markdown
## Finding 3: SQL injection candidate at user.rb:42

### The code (verbatim, with context)
```ruby
def search_users
  User.where("name = '#{params[:name]}'")
end
```

### Why this matches the SQL-injection check
**Criteria for SQL injection:**
- [x] User input flows into a string-interpolated SQL query
- [x] No upstream sanitization layer (checked: this is called directly from `UsersController#search`, no sanitization upstream)
- [x] Query executes against a real DB (not a stubbed or sandboxed query)
- [ ] N/A — bypass through ORM safety nets

### Evidence
- The interpolation: `"name = '#{params[:name]}'"` at user.rb:42
- The caller: `users_controller.rb:18` passes `params[:name]` straight through

### Proposed fix
Use parameterized queries: `User.where(name: params[:name])`

### What would change my mind
- If `params[:name]` is type-coerced or whitelisted upstream before this method is reached
- If this query only runs against a read-replica with restricted permissions
```

The criteria checkboxes do the work confidence numbers were trying to do — they make verification inspectable — but they're qualitative, criterion-by-criterion, and you can audit them by reading. The "what would change my mind" section forces the AI to state its falsifiability conditions.

This format is compatible with the verification gate (evidence section = the citation requirement) and incompatible with numeric confidence (replaced by criteria checkboxes).

**Generalizes beyond code review.** Same shape applies to:
- Office-hours-style product critiques (criteria: is the user explicit? is the problem named?)
- Plan reviews (criteria per dimension)
- Security audits (criteria per OWASP category)
- Any AI-evaluation task where you want auditable rigor without inventing a calibrated scale

The form *is* the prompt. The filled-in form *is* the artifact. The form definition + the filled answers together teach a reader what was checked, why it mattered, and what the AI actually verified.
