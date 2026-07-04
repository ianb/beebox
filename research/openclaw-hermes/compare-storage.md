# Comparison: Storage, Config, Data Model

CBX = Callback Box. Sources: `cbx-data-model.md`, `cbx-agent-core.md` (§6, turn persistence),
`openclaw-storage-config.md`, `hermes-storage-config.md`.

## 1. Side-by-side

| Concern | CBX | OpenClaw | Hermes |
|---|---|---|---|
| **Primary data substrate** | Plain files: `Name.type.card` (YAML frontmatter + markdown body) in a git repo; "the filesystem *is* the state" | JSON5 config (`openclaw.json`) + per-session JSONL transcript trees + a growing SQLite layer (`state/openclaw.sqlite`, ~60 tables) that has absorbed most legacy JSON stores ("database-first") | YAML config (`config.yaml`) + a single consolidated SQLite `state.db` (sessions/messages/FTS) that *replaced* a legacy per-session JSONL format |
| **Config format & validation** | No single "config" — behavior lives in card schemas (Zod) + `config/box.json`, `config/*.card`; validated on load, blocking pre-commit hook on invalid cards | JSON5, Zod `.strict()` schema (~30 domain files) + `superRefine` cross-field checks; JSON Schema derived for tooling | Single ~3400-line Python dict (`DEFAULT_CONFIG`) is both schema and defaults; deep-merge on load; no independent schema-validation library — shape *is* the dict |
| **Migration philosophy** | Two-tier: deterministic scripted migrations (`cb migrate`, append-only `config/migrations.jsonl` ledger, shared harness with noisy-mode data-loss detection) + agent-driven "procedure" migrations gated by a machine-checkable `severity: abort` validation | No numeric config-schema version; app semver stamped as `meta.lastTouchedVersion`; legacy-shape migrations are explicit doctor/migration commands, not auto-run; **future-version guard** refuses destructive actions if binary < config's last-touched version | Explicit `_config_version` int (currently 33) gates declarative migrations on config; **separately**, `state.db` uses "declarative column reconciliation" (Beets/sqlite-utils pattern) — diff live columns vs. schema, `ALTER TABLE ADD COLUMN` whatever's missing, so a skipped/reordered migration step can't drop a column; `schema_version` retained only for true data (row) backfills |
| **Session/transcript storage** | Delegates entirely to Claude Code CLI's own JSONL transcript (`~/.claude/projects/.../<sessionId>.jsonl`); CBX keeps only *pointers* (`chat-session-history.json`, `chat-sessions.json`, per-session turn-marker) plus a bounded in-memory `TurnBuffer` ring for resumable streaming, explicitly "an optimization over the durable transcript, never the only copy" | Own JSONL per session/topic, parent-linked entries forming a branching tree (`type: leaf` rewinds without deleting); `sessions.json` index (single pretty-printed JSON object, not JSONL); disk-budget-driven pruning tiers; compaction rotates to a new session id + file | Single SQLite DB: `sessions`/`messages` tables, `parent_session_id` self-FK for branches/compression/subagents, FTS5 (+ trigram for CJK) full-text search across all history |
| **Backup/restore** | Git *is* the backup/audit trail for card content; `git -C <box> reset --hard <sha>` is the documented rollback; asset manifests (sha256/size/mtime) are the non-git audit trail for binary assets kept out of history | `openclaw backup create` — tar of state dir + config + credentials + workspace, dedup'd by ancestor coverage, `--verify` re-reads the tar and validates manifest/hardlinks/path-escapes; recorded in `backup_runs` table; no cloud-sync | Two-tier: full zip backup (`hermes backup`/`import`, curated exclusion list driven by *specific incident numbers*, SQLite files snapshotted via `sqlite3 backup()` API not raw copy) + lightweight "quick snapshot" of curated critical files, auto-pruned to newest 20, plus pre-update/pre-migration auto-backup zips (newest 5 kept) |
| **Multi-instance/profile isolation** | A "box" is any directory; multiple boxes served by one deployment (`BoxSelection.tsx`); no explicit "profile" concept — isolation is just "different box = different git repo" | `--profile <name>` → fully separate `~/.openclaw-<name>` state dir + port; gateway singleton enforced via lock file + PID/cmdline/port liveness checks, stale-lock reclaim | `hermes -p <name>` → fully separate `~/.hermes/profiles/<name>/`; `SessionDB(read_only=True)` opens *another* profile's live `state.db` via `mode=ro` for cross-profile dashboards with zero write-lock contention; container-boot reconciler distinguishes "runtime state" (PID/lock files, never portable) from durable state |
| **Atomic-write/corruption defenses** | Card writes are parse-mutate-reserialize on a single file (no rename/lock protocol documented); pre-commit `cb validate --staged` blocks bad cards from ever landing in git history; asset-manifest desync is a hard pre-commit error | Config: atomic temp-file+rename (`0o600`), 5-slot backup ring on *every* write, JSONL audit log with content hashes, clobber-protection diverting large-content-loss writes to `.rejected.<ts>`, optimistic concurrency via content-hash mismatch + retry. Sessions: FIFO+advisory-lock writes, torn-write detection/newline-prefix repair on append, `sessions.json` read has Windows torn-write retry via `Atomics.wait` | Config: corrupt YAML is snapshotted to `.corrupt.<ts>.bak` and **never auto-repaired** — the broken file is left for a human fix (deliberate asymmetry vs. state.db). `state.db`: WAL + macOS `checkpoint_fullfsync` barrier (launchd SIGTERM corruption fix), malformed-`sqlite_master` self-repair with pre-surgery raw backup, jittered-backoff write retry to avoid convoy effects |

## 2. Confirmations — where CBX matches

- **Env/secret substitution pattern.** Both competitors implement `${VAR}` resolution with round-trip preservation on write-back (OpenClaw's `restoreEnvVarRefs`, Hermes's `_preserve_env_ref_templates`) so secrets are never baked into a config file at rest. CBX's `config/connectors/<name>.secret.json` gitignore-and-separate-file approach is a cruder version of the same goal (keep secrets out of the tracked/diffable surface) — same instinct, simpler mechanism given CBX has no single monolithic config file to substitute into.
- **Append-only migration ledgers.** OpenClaw's `migration_runs` table and Hermes's `_config_version` gate are both structurally the same idea as CBX's `config/migrations.jsonl`: a durable, ordered record of what has already been applied, diffed against a canonical list, so re-running is idempotent and a fresh install seeds as fully-applied. All three independently arrived at "never re-derive migration state by inspection; keep a ledger."
- **Runtime/process state excluded from backup and portability.** Hermes explicitly excludes `gateway.pid`/`gateway_state.json`/`processes.json` from `hermes import`; OpenClaw's own PID/lock files live *outside* the state dir entirely (`os.tmpdir()`). CBX draws the identical line: `.cb-lock` (reactor pid) and `.cb-serve.pid` are runtime, gitignored, never part of the box's git-backed durable state — a box moved to another machine (clone) sheds them automatically for free, without needing an exclusion list, because git never tracked them to begin with.
- **Instance isolation via full separate roots, not in-store partitioning.** CBX's "box = independent git repo, independent directory" is the same shape as OpenClaw's `--profile` and Hermes's `profiles/<name>/` — a full separate state universe rather than a shared store with an instance-id column. All three avoid partitioned-single-store multi-tenancy for the top-level isolation boundary.
- **Validation as a blocking gate at the write boundary, not just on read.** CBX's pre-commit `cb validate --staged` blocking bad cards from ever entering git history is philosophically the same move as OpenClaw's zod `.strict()` config validation and Hermes's config-version gate: catch shape problems at the moment of commit rather than deferring to first-use.

## 3. Divergences

### The big one: SQLite convergence vs. files-first

Both OpenClaw and Hermes started with (or still partially retain) JSON/JSONL file stores for
session and operational state, and both have been **consolidating toward SQLite** — OpenClaw
explicitly enforces this via a lint-time "database-first" AST guard that blocks new code from
writing legacy JSON stores; Hermes went further and already *replaced* per-session JSONL with a
single `state.db`. CBX has moved in the opposite direction for its primary data (cards) — away
from a hypothetical database and toward files+git — while quietly running two auxiliary SQLite
DBs (`events.db`, `usage.db`) for exactly the kind of write-heavy, query-heavy, non-human-facing
state that OpenClaw/Hermes push into their `state.db`.

This isn't really a disagreement so much as **different data having different natural homes**:

- **SQLite wins** when: data is high-volume append-mostly with query needs beyond "list this
  directory" (full-text search across years of messages, joins across sessions/messages/
  compression-lineage), many processes read/write concurrently at high frequency (gateway + CLI +
  cron + subagents all hitting the same store), and the data is fundamentally *not* meant to be
  hand-read or diffed by a human (session bookkeeping, plugin KV state, device pairing).
- **Files+git win** when: a human (or an agent standing in for one) needs to read, diff, edit, or
  audit the data directly; the data's *history* is itself a first-class asset (git log as
  provenance); write volume is naturally low and per-item (one card write per pipeline step, not
  thousands of message-row inserts/sec); and the natural query pattern is "what's in this
  directory" / "what changed since commit X," which a filesystem+git already answers for free.

CBX's cards (memos, todos, people, jobs) sit squarely in the second bucket — a card is meant to be
opened in a text editor and is a unit a human plausibly wants to `git blame`. CBX's `events.db`
and `usage.db` sit in the first bucket — nobody reads the event bus by eye. The honest trade-off
CBX accepts: no full-text search across all card content (no FTS5 equivalent), weaker concurrent-
write guarantees for very high card-churn scenarios (no WAL/busy_timeout tuning — a card write is
"parse → mutate → reserialize" on one file, not documented to have file-locking against concurrent
writers the way OpenClaw's session store or Hermes's `state.db` do), and no cross-card structured
query beyond directory listing / grep. In exchange, CBX gets git-native diff/audit/rollback for
free on every card, and a human can `cat` any piece of state without a client. Given CBX's stated
identity ("the filesystem *is* the state," designed for git-auditability and human legibility as
goals, not accidents), this is a deliberate and defensible trade — but it is worth being honest
that neither competitor made the same choice for their comparable "lots of small structured
records with a stable schema" data (OpenClaw's ~60-table shared DB, Hermes's `sessions`/`messages`
tables), suggesting CBX is betting more on human/agent legibility mattering more than query power
and concurrent-write throughput for *its* class of workload.

### Config: no single config object vs. one big validated object

OpenClaw and Hermes both have a single config file with a total, versioned, comprehensively-
validated (or at least fully-enumerated) shape. CBX has no equivalent — behavior config is spread
across `config/box.json`, `config/*.card` (personality, connectors, procedures), and card schemas
themselves. This is consistent with CBX's card-centric design (config *is* data, expressed the
same way as everything else) but means CBX has no single artifact to point a "config doctor" at,
no single JSON-Schema-for-tooling export, and no single place a future-version guard could stamp
a "last written by version X" marker across the whole configuration surface at once. Each piece
(schemas, box.json, connector configs) would need its own versioning story if CBX ever wanted
OpenClaw/Hermes-grade downgrade protection.

### Config corruption handling: silent fallback+snapshot vs. hard-block

Hermes's config corruption policy is a genuinely different philosophy from CBX's: a broken
`config.yaml` silently falls back to `DEFAULT_CONFIG` (app keeps running, but *every* override is
silently ignored until a human notices the warning) with a forensic snapshot taken. CBX's
equivalent failure mode — a card with invalid frontmatter — is the opposite: `cb validate --staged`
**blocks the commit outright**, and a bad card that somehow lands still fails Zod validation loudly
on every subsequent load (no silent default-fallback). CBX's choice is stricter and arguably safer
for data cards (silently running with a memo's fields defaulted-away would be worse than refusing
to touch it), but CBX has no equivalent to Hermes's "keep the *system* running even though *this
one file* is broken" resilience story — a hypothetical corrupt `config/box.json` doesn't have a
documented graceful-degradation path the way Hermes's `config.yaml` does.

### Backup: git as the backup vs. explicit backup CLI

CBX relies on git itself (clone, `reset --hard`, remotes) as the backup/restore mechanism for
card content, plus asset manifests as a secondary audit trail for binary assets kept out of git.
Neither OpenClaw nor Hermes can lean on this because their primary state (SQLite DBs, session
JSONL) isn't naturally git-friendly (binary format, high churn, WAL sidecars) — hence their
purpose-built backup CLIs with SQLite-safe-copy, exclusion lists tuned by incident history, and
verify-on-restore. CBX gets backup "for free" for cards, but has **no equivalent story for its own
SQLite auxiliary DBs** (`events.db`, `usage.db`) or for gitignored runtime state — if `usage.db`
were corrupted or a box's `.callback-box/` directory were lost, there's no documented CBX-side
recovery path analogous to Hermes's quick-snapshot or OpenClaw's `backup create --verify`.

### Multi-process write safety: advisory locks + hashes vs. undocumented

OpenClaw and Hermes both have extensive, explicit machinery for concurrent writers to the same
store (FIFO queues, AsyncLocalStorage locks, content-hash optimistic concurrency, WAL + jittered
retry, compression locks). CBX's card-write path ("parse → mutate → reserialize" on one file) has
no documented equivalent — no mention of file locking, hash-based conflict detection, or retry
logic for two agents/processes editing the same card concurrently. This is plausibly fine today
(CBX's concurrency model is closer to "one agent works a box at a time" than "many processes hammer
one store"), but it's an asymmetry worth naming rather than assuming away as boxes gain more
concurrent actors (reactor + web chat + connectors all touching cards at once).

## 4. Steal-this — prioritized ideas for CBX

1. **Config-write hardening for `config/box.json` and other singleton config files (High value, Low-Medium effort).**
   OpenClaw's pattern — atomic temp-file+rename, a small backup ring (e.g. `.bak`/`.bak.1`/`.bak.2`),
   and a JSONL audit log of writes (timestamp, hash before/after, byte counts) — is cheap to bolt
   onto CBX's few singleton config files (`config/box.json`, `config/main.personality.card`,
   `config/migrations.jsonl` itself). Cards in general already get git-history-as-audit-log for
   free, but the *handful* of files agents mutate imperatively via direct read-modify-write (not
   through the card lint/validate path) would benefit most. Effort: small, self-contained module,
   no schema changes.

2. **A future-version guard for boxes (Medium-High value, Low effort).**
   Stamp something like `meta.lastCbVersion` into `.cb-box` or `config/box.json` on every `cb`
   invocation that writes, and refuse destructive operations (`cb migrate`, bulk schema
   migrations) if the running `cb` binary is older than the version that last touched the box —
   mirroring OpenClaw's `future-version-guard.ts`. This directly protects against the realistic
   failure mode of an agent on an older worktree branch running `cb migrate` against a box that a
   newer `cb` has already advanced. Low effort: one version-compare check gating the existing
   migration entrypoint.

3. **Verified backups for the SQLite auxiliary DBs (Medium value, Low effort).**
   `events.db` and `usage.db` currently have no backup story at all, unlike every piece of card
   content (covered by git). Add a `cb backup` (or extend `cb init`/existing tooling) that does an
   `sqlite3 .backup` (not raw file copy, to avoid WAL torn-copy — Hermes's exact rationale) of
   these two DBs into a gitignored or git-LFS-tracked snapshot directory, on a schedule or as part
   of `cb finalize`/nightly maintenance. Cheap because it's two known files with a known-safe
   SQLite API to call.

4. **Corrupt-card quarantine, mirroring Hermes's corrupt-config snapshot (Medium value, Low effort).**
   When `cb validate` encounters a card that fails to parse (not just fails schema validation —
   genuinely malformed YAML/frontmatter), snapshot it to `<path>.corrupt.<timestamp>.bak` before
   any repair/migration script touches it, the way Hermes does for `config.yaml`. Today a bad
   migration or lint-fix script could clobber a malformed card with no forensic trail beyond git
   history (which may not have committed the broken state at all, e.g. mid-edit corruption from a
   crashed process). Low effort, same pattern as OpenClaw's clobber-protection `.rejected.<ts>`
   snapshots.

5. **Declarative-reconciliation posture for CBX's own SQLite schemas (Low-Medium value, Low effort, do when next touched).**
   `events.db`/`usage.db` presumably have their own ad hoc schema evolution story; adopting
   Hermes's "diff live columns against canonical `CREATE TABLE`, `ALTER TABLE ADD COLUMN`
   whatever's missing" pattern instead of/alongside version-gated migrations would make these two
   DBs self-healing against skipped migration steps, consistent with how `cb migrate` already
   treats box-level migrations as an append-only ledger. Not urgent — only worth doing next time
   either schema changes.

6. **Optimistic-concurrency check before card reserialize, if/when concurrent writers become real (Low priority now, revisit if reactor+chat+connector concurrency increases).**
   Not urgent given CBX's current "mostly one active agent per box" model, but if multiple
   concurrent writers to the same card become common, OpenClaw's content-hash-based
   `assertBaseHashMatches` (read hash → mutate → write only if hash unchanged, else retry) is a
   lightweight pattern to adopt without introducing real file locking.
