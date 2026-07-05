# gstack ↔ callback-box/docs/ideas.md overlap

Pairing each gstack skill that's marked `try`, `integrate`, `integrate (parts)`,
or `tbd (mine ideas)` against ideas.md entries that point at the same territory.
Goal: when one of these gstack experiments lands in callback-box, it lands on
top of an idea we've already been chewing on, not from a cold start.

Status labels mirror skills.md.

## Already cross-linked

- **`design-consultation`, `design-shotgun`** (tbd, mine ideas)
  ↔ ideas.md §**"Chat controls — try a design consultation pass"** (line ~859).
  This entry already names both gstack skills and pre-commits to the SAFE/RISK
  and memorable-thing patterns. When we sit down to do chat-controls design
  work, the briefing is essentially: read these gstack notes, apply only the
  SAFE/RISK + memorable-thing patterns, skip the gstack infrastructure.

## Strong overlap, not yet linked

- **`investigate`** (integrate parts: Iron Law, fail-then-pass regression,
  DEBUG REPORT format, Pattern Analysis table)
  ↔ ideas.md §**"Retrospective session scan — surfacing CLAUDE.md and
  tool improvements"** (recent) and §**"Doc usage mining — what agents
  actually open"**.
  Same observation: mining session transcripts for what went wrong /
  what was looked up. The DEBUG REPORT format is exactly the kind of
  structured artifact the retrospective session scan would emit. The
  "callback debugging guide" artifact the skills.md note hints at is a
  natural output of either lane — could be one file (e.g. `docs/debugging.md`)
  populated by both ingestion paths.

- **`codex`** (integrate)
  ↔ ideas.md §**"Decision-shaped thinking discipline (instead of councils)"**
  (line 142).
  That entry argues a single agent with a deliberation discipline beats
  multi-agent councils — *unless* the perspectives are grounded in
  genuinely different inputs. codex (different model, same code) is exactly
  the qualifying case. When we wire codex in, the connection to this
  entry should be explicit: codex isn't a council, it's the one shape of
  multi-agent that the entry endorses.

- **Meta: Observe → codify (`scrape` → `skillify`)**
  ↔ ideas.md §**"Correction counting → spec promotion"** (line 206),
  §**"Declared per-box autonomy matrix with encounter queue"** (line 224),
  §**"Hooks at the agent-loop level"** (line 317).
  All three are the same observe-then-promote shape that scrape→skillify
  codifies as a workflow. The autonomy matrix's "encounter queue" is
  almost literally the scrape-to-skill pipeline applied to permission
  decisions.

- **Meta: Cross-model disagreement as signal** (`autoplan`'s most cited idea)
  ↔ ideas.md §**"Decision-shaped thinking discipline (instead of councils)"**.
  Same as codex above — the entry already names cross-model disagreement
  as the case where multi-agent earns its keep.

## Adjacent / worth knowing about

- **`plan-eng-review`** (integrate parts: failure-modes table,
  user-flow edge-cases checklist, engineering-principles.md)
  ↔ ideas.md §**"Memory-writing guidance for the boxholder agent"** and
  §**"Behavioral profile: autonomy-vs-escalation calibration"** — the
  stated-preferences-as-review-spine pattern is the same shape as building
  up a behavioral profile, but pointed at engineering taste instead of
  conversational style. The `engineering-principles.md` artifact doesn't
  exist yet — adding it would be a discrete worktree's work and a candidate
  new ideas.md entry.

- **`learn`** (reference: project learnings manager)
  ↔ ideas.md §**"Overnight session compaction with custom compaction
  message"** + §**"Memory-writing guidance"**.
  Same problem space: what gets extracted from a session, where it
  lives, who reads it later. Worth reading `learn`'s SKILL.md as a
  reference point when designing the compaction prompt.

- **`retro`** (reference: weekly retrospective from commits)
  ↔ ideas.md §**"Retrospective session scan"** and §**"Correction
  counting → spec promotion"**.
  `retro` mines git history; our retrospective scan mines session
  transcripts. They could share a digest surface (one weekly file with
  both ingestions feeding in).

## No strong overlap

- **`office-hours`, `plan-ceo-review`** (try) — external-pressure-test
  framing, no ideas.md analog. Best done as standalone experiments
  against a real plan rather than encoded in ideas.md.

- **`cso`** (try, STRIDE+OWASP security audit) — no ideas.md entry yet.
  Could be a new entry ("periodic security audit pass") if/when the time
  feels right; for now just an experiment to run once.
