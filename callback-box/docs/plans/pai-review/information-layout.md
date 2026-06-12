# Information layout — how PAI organizes context, memory, and state

Sources:
- `$PAI/CLAUDE.md` (the @-imports and routing tables)
- `$PAI/PAI/DOCUMENTATION/Memory/MemorySystem.md` (581 lines — the MEMORY contract)
- `$PAI/PAI/MEMORY/KNOWLEDGE/README.md`
- `$PAI/PAI/PULSE/PULSE.toml` (scheduling config)

cb's comparable thinking is `docs/agent-knowledge.md` (the knows-directly /
knows-about / discoverable layering) and `docs/box-layout.md`. The two systems
arrived at the same core architecture independently; the differences are at the
edges, and a few of PAI's edges are better.

## 1. Context loading: small always-loaded core + explicit routing table

PAI loads exactly five files into every session via `@`-imports at the top of
CLAUDE.md:

> @PAI/USER/PRINCIPAL_IDENTITY.md
> @PAI/USER/DA_IDENTITY.md
> @PAI/USER/PROJECTS/PROJECTS.md
> @PAI/USER/TELOS/PRINCIPAL_TELOS.md
> @PAI/DOCUMENTATION/ARCHITECTURE_SUMMARY.md

Note three of the five are *generated compressions* of larger source trees
(PRINCIPAL_TELOS summarizes nine TELOS files; ARCHITECTURE_SUMMARY summarizes the
DOCUMENTATION tree). Everything else is reachable through routing tables — topic →
path, load on demand:

> Startup context is `@`-imported above (PRINCIPAL_IDENTITY, DA_IDENTITY, PROJECTS,
> PRINCIPAL_TELOS) — always available. Use the routing table below to find file
> paths for any additional specialized context. **Load on-demand only.**
>
> | Topic | Path |
> |-------|------|
> | **Life OS thesis (what PAI is for)** | `~/.claude/PAI/DOCUMENTATION/LifeOs/LifeOsThesis.md` — canonical source of truth |
> | Memory system | `~/.claude/PAI/DOCUMENTATION/Memory/MemorySystem.md` |
> | Hook system | `~/.claude/PAI/DOCUMENTATION/Hooks/HookSystem.md` |
> | ISA format spec | `~/.claude/PAI/DOCUMENTATION/IsaFormat.md` |
> | Writing style | `~/.claude/PAI/USER/WRITINGSTYLE.md` |
> | Mission | `~/.claude/PAI/USER/TELOS/MISSION.md` |
> | … | (four tables: PAI System / Identity & Voice / Life Goals / Work) |

One row even routes to an agent instead of a file: "Claude Code knowledge →
`Agent(subagent_type="claude-code-guide")`."

The stated token economics (from `IsaFormat.md` §Design Rationale): "**Reference
file pattern**: This spec lives at `~/.claude/PAI/DOCUMENTATION/IsaFormat.md`, not
inline in CLAUDE.md. Saves ~2,500 tokens/response."

**vs. cb:** same layering as `docs/agent-knowledge.md` (always-loaded → rules
triggered by path globs → referenced-but-not-loaded → discoverable), and cb's
~3000-line generated agent guide already contains pointer sections. Differences
worth noting:

- PAI's always-loaded core is *who you are, who I am, what you're working toward,
  what's active* — identity and goals, with operational detail demoted to routing.
  cb's guide leads with operational material (directory layout, commands, card
  types) and has no goals layer to load. If cb adds telos (see
  [telos.md](./telos.md)), it belongs in the always-loaded tier.
- PAI's routing is one flat, visually scannable table per topic area; cb's
  pointers are distributed through guide prose. A consolidated topic→path table in
  the agent guide is a cheap legibility win and is also where a rule-routing table
  (see [prompts.md](./prompts.md) §3) naturally sits.

## 2. MEMORY: tiered by purpose, with promotion between tiers

Top-level layout of `$PAI/PAI/MEMORY/`:

```
WORK/         per-task ISAs (spec+log per unit of work; archived on completion)
PROJECT/      project ISAs (long-lived)
LEARNING/     extracted lessons, categorized; JSONL signal ledgers
KNOWLEDGE/    curated typed entity graph (promotion target)
RESEARCH/     verified research artifacts
RELATIONSHIP/ DA↔Principal relationship notes
OBSERVABILITY/ tool activity, classifier decisions, hook events (JSONL)
SCRATCHPAD/   ephemeral
+ AUTO, BOOKMARKS, DATA, RAW, REFERENCE, SKILLS, VERIFICATION, WISDOM
```

The design idea: **raw accumulates at the edges; only curated material is promoted
inward.** From `KNOWLEDGE/README.md`:

> Where `MEMORY/` overall is append-mostly raw record, `KNOWLEDGE/` is curated and
> structured. … Harvesters elsewhere in `MEMORY/` propose candidates that get
> promoted into here only after curation. … Treat structure here as load-bearing —
> schema changes ripple through every consumer.

This is the same shape as cb's retro pipeline (transcripts → observation ledger →
integrated beliefs), generalized to all knowledge, not just beliefs about the
boxholder.

### KNOWLEDGE — the typed graph and its lifecycle

From `MemorySystem.md:128-140`, the full contract:

> **Format:** Markdown files with YAML frontmatter (entity_type, tags, status).
> **4 entity types:** People (human beings — OSINT, contacts, profiles), Companies
> (organizations — research, competitors, partners), Ideas (insights, theses,
> analyses, frameworks), Research (multi-source investigations with methodology and
> verified findings)
> **The lookup test:** "Would {{PRINCIPAL_NAME}} look this up by name?" — if yes,
> it's knowledge. If not, it belongs in WORK/ or LEARNING/.
> **What doesn't belong:** Task logs, algorithm reflections, ISA checklists,
> verification stubs → WORK/ and LEARNING/, not KNOWLEDGE/
> **Note types:** reference, synthesis, moc, source, temporal
> **Status lifecycle:** seedling → budding → evergreen (90-day expiry for
> unreferenced seedlings → `_archive/`)
> **Linking:** `[[kebab-case-wikilinks]]` for explicit links, tags for
> cross-cutting, `rg` for backlinks, semantic embeddings deferred
> **Navigation:** `_index.md` MOC dashboards per entity type (auto-generated …)

Three things here are genuinely good:

1. **The lookup test** — a one-sentence membership rule ("would you look this up by
   name?") that keeps an archive from becoming a junk drawer. cb's store
   directories would benefit from membership tests this crisp in their briefings.
2. **The decay lifecycle** — `seedling → budding → evergreen`, with unreferenced
   seedlings auto-archived after 90 days. cb's evidence model promotes beliefs on
   recurrence but nothing ever demotes or expires; a symmetric rule (hypothesis
   beliefs untouched for N months → archived, or escalated to a question card)
   would keep the personality/guide cards honest. Same applies to any future
   knowledge store.
3. **Topic as tag, not directory** — "Topic (security, AI, business) is a tag on
   the entity, not a separate domain." Prevents the taxonomy explosion cb's
   landmark system solves a different way (landmarks discovered by glob, not by a
   central registry).

The 8 typed link types (supports, contradicts, extends, part-of, instance-of,
caused-by, preceded-by, related) live in the Knowledge skill (`$PACKS/Knowledge/`);
the only enforcement is prose. Probably more ontology than cb wants — but
`contradicts` alone is interesting, since "find conflicting claims" is a retro-like
audit operation.

### LEARNING — categorized by failure locus

From `MemorySystem.md:179-193`:

> - `LEARNING/SYSTEM/YYYY-MM/` - PAI/tooling learnings (infrastructure issues)
> - `LEARNING/ALGORITHM/YYYY-MM/` - Task execution learnings (approach errors)
> - `LEARNING/SYNTHESIS/YYYY-MM/` - Aggregated pattern analysis (weekly/monthly reports)
>
> | Directory | When Used | Example Triggers |
> |-----------|-----------|------------------|
> | `SYSTEM/` | Tooling/infrastructure failures | hook crash, config error, deploy failure |
> | `ALGORITHM/` | Task execution issues | wrong approach, over-engineered, missed the point |
> | `FAILURES/` | Full context for low ratings (1-3) | severe frustration, repeated errors |

The taxonomy of *whose fault was it* (the infrastructure vs. the approach) is the
useful bit — it routes the fix to the right surface (patch a hook vs. amend a
guide). The capture mechanisms feeding it (SatisfactionCapture hook ratings,
implicit sentiment) are the lightweight-signal approach we're explicitly not
taking; cb retro's qualitative transcript mining feeds the same taxonomy fine.

## 3. WORK: spec and log co-located, sync derived

Per-task layout is one directory, one file: `MEMORY/WORK/{slug}/ISA.md` — spec,
decisions, evidence in a single artifact (see [isa.md](./isa.md)). The sync
pipeline is strictly one-directional (`IsaFormat.md` §Sync Pipeline):

> The AI is the sole writer. Hooks only read. work.json is derived state. KV is
> derived from work.json.

That sentence is a good invariant statement, and it matches cb's stance (cards are
canonical; `.callback-box/` artifacts are derived). PAI is stricter in one way:
*hooks never write the artifact*, so there's exactly one writer per file class.

## 4. Naming conventions

Casing is used as a signal channel: SCREAMING_SNAKE for identity/goal files the
human owns (`MISSION.md`, `DA_IDENTITY.md`, MEMORY dir names), PascalCase for
skills/workflows/tools, camelCase for code, `*.hook.ts` suffix for hooks,
`YYYYMMDD-HHMMSS_kebab` slugs for work dirs. Not better than cb's
`Title.type.card` (which carries *machine-read* type information and validation);
noted because it's at least consistent, and the type-in-filename principle is
shared ("canonical discriminator: filename" in both systems).

## 5. Scheduling config — one detail worth taking

`$PAI/PAI/PULSE/PULSE.toml` header, verbatim:

> ```toml
> # type = "script" → runs command, $0 cost
> # type = "claude" → spawns claude --print, costs tokens
> # output = voice | telegram | ntfy | email | log
> # Sentinels: NO_ACTION, NO_URGENT, NO_EVENTS → suppress dispatch
> ```

Two ideas:

- **Sentinel outputs.** A scheduled job whose output is a sentinel produces no
  notification. This is the right contract for "daily check that usually has
  nothing to say," and maps directly onto cb scheduled scripts that end in
  notification cards: define a sentinel (or a structured-output field) meaning
  "ran fine, nothing to report," and have finalize/notification dispatch skip it.
  Cheap, immediately useful.
- **Cost class declared per job** (`script` = $0 vs `claude` = tokens), with
  per-job cost ceilings elsewhere in the config (`heartbeat_cost_ceiling = 0.01`).
  cb has `maxBudgetUsd` on invocations; surfacing the cost class in the
  scheduled-script card (and in `cb scheduler status` output) is a legibility win
  more than new capability.

(The `[da]` section of this file configures DA heartbeat/diary/growth schedules —
no shipped code consumes them; the comment block confirms the reactive jobs live on
a second private machine. See README caveats.)

## 6. Disclosure containment — noted for completeness

PAI's privacy layout is structural: zones declared in code
(`hooks/lib/containment-zones.ts`), a PreToolUse `ContainmentGuard` hook blocking
writes that move content across zones, `.pai-protected.json` at the repo root
(protected files, secret-detection regexes, forbidden directories), and a
12-gate shadow-release pipeline as "the ONLY sanctioned path" from private to
public. cb's exposure profile is different (boxes aren't published), but cb does
have outbound paths — email, Telegram, deploy. A deterministic pattern scan over
outbound cards at `cb finalize` time (PAI's egress-inspector idea: pattern
matching, explicitly *not* LLM judgment) is the transferable piece.

## Summary of layout-level takeaways for cb

1. Always-loaded tier should be identity + goals + active state, compressed via
   compile steps; operational detail demoted to an explicit topic→path routing
   table. cb has the compile machinery; it lacks the goals content and the
   consolidated table.
2. Adopt membership tests ("would you look this up by name?") and a decay
   lifecycle for inferred knowledge/beliefs.
3. State the one-writer-per-file-class invariant where cb already practices it.
4. Sentinel outputs for scheduled scripts; cost class surfaced on schedule cards.
5. Pattern-based egress scan at finalize.
