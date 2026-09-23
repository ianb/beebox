/**
 * Who each `bbx` verb is for — the whole classification, as data.
 *
 * The rule (boxholder, 2026-09-14): `bbx` carries only what a box agent can
 * run, whether from chat, a scheduled script, or a procedure. A verb an agent
 * can never call — the hub spawns it, systemd starts it, deploy runs it, or it
 * opens a browser for a person — does not belong in `bbx` at all. Until those
 * verbs can leave the binary
 * (`issues/code-quality/2026-08-08-extract-bbx-serve-from-the-box-cli.md`),
 * they live under `bbx engine`, and this table is the list that extraction
 * takes.
 *
 * "Can an agent call it", not "would an agent usually call it". `validate`
 * runs from a git hook, `finalize` from the reactor, and `docs refresh` from
 * `deploy.sh` — all three are still things an agent may run on its own box, so
 * all three stay. The verbs that leave are the ones with no agent-reachable
 * form at all.
 *
 * No `Command` objects here. `surface-build.ts` is the only module that maps a
 * name to a registration, so a test can import this table without loading the
 * CLI (`test/cli/surface.doctest.md`).
 */

/** Who can invoke a verb: the box agent, or only a person or a unit file. */
export type Audience = "agent" | "engine";

/**
 * How the agent-surface doctest exercises a verb. Exactly one arm, so an entry
 * cannot silently have neither — a verb with no safe invocation has to say why
 * rather than just omit the field.
 */
export type Smoke =
  /** Argv (after `bbx`) that is safe, read-only, and needs no fixtures. */
  | { readonly run: readonly string[] }
  /** Why this verb has no such invocation. */
  | { readonly skip: string };

interface Verb {
  readonly name: string;
  /**
   * The subcommands this entry owns. Present only for a family that splits
   * across audiences, where two entries share a `name`.
   */
  readonly subcommands?: readonly string[];
}

export type SurfaceEntry =
  | (Verb & { readonly audience: "agent"; readonly smoke: Smoke })
  /** `reason` is required: an eviction has to justify itself in the table. */
  | (Verb & { readonly audience: "engine"; readonly reason: string });

/** Mutating verbs share a skip reason; naming it once keeps them comparable. */
const MUTATES = { skip: "mutates box content; no read-only form" } as const;

export const SURFACE: readonly SurfaceEntry[] = [
  // ---- Cards and box content -------------------------------------------
  { name: "create", audience: "agent", smoke: MUTATES },
  { name: "rm", audience: "agent", smoke: MUTATES },
  { name: "mv", audience: "agent", smoke: MUTATES },
  { name: "ls", audience: "agent", smoke: { run: ["ls", "."] } },
  { name: "search", audience: "agent", smoke: { run: ["search", "zqxjkv"] } },
  { name: "contains", audience: "agent", smoke: { run: ["contains", "list"] } },
  { name: "todos", audience: "agent", smoke: { run: ["todos"] } },
  { name: "query", audience: "agent", smoke: { run: ["query", "todos"] } },
  { name: "validate", audience: "agent", smoke: { run: ["validate"] } },
  { name: "refresh-maps", audience: "agent", smoke: MUTATES },
  { name: "extfile", audience: "agent", smoke: MUTATES },
  { name: "attachments", audience: "agent", smoke: { run: ["attachments", "verify"] } },
  { name: "pdf", audience: "agent", smoke: { skip: "needs an existing pdf card to re-extract" } },
  { name: "relink", audience: "agent", smoke: MUTATES },
  { name: "migrate-view-links", audience: "agent", smoke: MUTATES },

  // ---- Questions and jobs ----------------------------------------------
  { name: "answer", audience: "agent", smoke: MUTATES },
  { name: "dismiss", audience: "agent", smoke: MUTATES },
  { name: "finish", audience: "agent", smoke: { skip: "deletes the job card it is given" } },
  { name: "intake", audience: "agent", smoke: MUTATES },
  { name: "triage", audience: "agent", smoke: MUTATES },
  { name: "handle", audience: "agent", smoke: MUTATES },
  { name: "reactor", audience: "agent", smoke: MUTATES },
  { name: "finalize", audience: "agent", smoke: MUTATES },
  { name: "procedure", audience: "agent", smoke: { run: ["procedure", "list"] } },
  { name: "trick", audience: "agent", smoke: { run: ["trick"] } },
  { name: "host", audience: "agent", smoke: { skip: "installs system packages as root through sudo" } },

  // ---- Reading the box's own state -------------------------------------
  { name: "status", audience: "agent", smoke: { run: ["status"] } },
  { name: "health", audience: "agent", smoke: { run: ["health"] } },
  { name: "scheduled", audience: "agent", smoke: { run: ["scheduled"] } },
  // Per-box, not fleet-wide: `--box` defaults to the current directory, and the
  // generated reference tells agents to reach for `tick --script <name> --force`
  // when the boxholder asks for a run from chat. The scheduler daemon does not
  // go through this verb — it calls `runTick` in-process.
  { name: "tick", audience: "agent", smoke: { run: ["tick", "--dry-run"] } },
  { name: "session", audience: "agent", smoke: { run: ["session", "--list"] } },
  { name: "usage", audience: "agent", smoke: { run: ["usage", "--schema"] } },
  { name: "docs", audience: "agent", smoke: { skip: "`refresh` rewrites generated docs and commits" } },
  { name: "agent-context", audience: "agent", smoke: { run: ["agent-context"] } },
  { name: "location", audience: "agent", smoke: { run: ["location", "get"] } },
  { name: "view", audience: "agent", smoke: { run: ["view", "check"] } },
  { name: "retro", audience: "agent", smoke: { run: ["retro", "status"] } },
  { name: "doctor", audience: "agent", smoke: { skip: "repairs box configuration by default" } },

  // ---- Talking to the boxholder ----------------------------------------
  { name: "chat", audience: "agent", smoke: { run: ["chat", "whats-changed"] } },

  // ---- Credentialed: these delegate to the box's server under the agent
  //      profile (`cli/lib/credentialed-verb.ts`), which is exactly what the
  //      smoke run is checking.
  { name: "calendar", audience: "agent", smoke: { run: ["calendar", "today"] } },
  { name: "drive", audience: "agent", smoke: { run: ["drive", "status"] } },
  { name: "connector", audience: "agent", smoke: { run: ["connector", "gmail", "pending"] } },
  { name: "force-wakeup", audience: "agent", smoke: { skip: "runs a real wakeup cycle on the server" } },

  // ---- Ingestion --------------------------------------------------------
  { name: "scan-import", audience: "agent", smoke: { skip: "needs input files to import" } },
  { name: "upload", audience: "agent", smoke: { skip: "needs input files to upload" } },

  // ---- Split families ---------------------------------------------------
  {
    name: "scheduler",
    subcommands: ["status", "log"],
    audience: "agent",
    smoke: { skip: "inspects a launchd/systemd daemon the test host may not run" },
  },
  {
    name: "scheduler",
    subcommands: ["start", "install", "uninstall"],
    audience: "engine",
    reason: "daemon lifecycle: `start` is a systemd and launchd ExecStart, `install` writes the launchd plist",
  },
  {
    name: "pub",
    subcommands: ["draft", "ls", "status"],
    audience: "agent",
    smoke: { run: ["pub", "ls"] },
  },
  {
    name: "pub",
    subcommands: ["setup", "go", "revoke"],
    audience: "engine",
    reason: "`setup` needs a wrangler login; `go` is the human-only flip and asks for interactive confirmation",
  },
  {
    name: "secrets",
    subcommands: ["declare", "describe", "status"],
    audience: "agent",
    smoke: { skip: "`status` takes a box slug this test does not know" },
  },
  {
    name: "secrets",
    subcommands: ["set", "rm", "grant", "revoke", "list", "copy-grants", "migrate"],
    audience: "engine",
    reason: "mutations refuse an agent session without --agent-confirmed; `list` and `copy-grants` span the machine",
  },

  // ---- Engine: no agent-reachable form ----------------------------------
  { name: "maintenance", audience: "engine", reason: "deploy holds box ownership across activation; runs as root and spans the fleet" },
  { name: "serve", audience: "engine", reason: "the hub spawns one per box (src/hub/supervisor.ts:441)" },
  { name: "hub", audience: "engine", reason: "a systemd ExecStart, and the dev router's backend spawn" },
  { name: "boxes", audience: "engine", reason: "the machine-wide box manifest; an agent has no second box" },
  { name: "activity", audience: "engine", reason: "reports across every box; the deploy's at-rest gate" },
  { name: "wakeup", audience: "engine", reason: "tooling profile only; `force-wakeup` is the agent's counterpart" },
  { name: "tailscale", audience: "engine", reason: "machine networking, outside any box" },
  { name: "push", audience: "engine", reason: "`push test` fires a web push at this box's subscribers to prove delivery — an operator probe" },
  { name: "google-auth", audience: "engine", reason: "an interactive browser OAuth flow" },
  { name: "auth", audience: "engine", reason: "local accounts; every verb refuses an agent session without --agent-confirmed" },
  { name: "init", audience: "engine", reason: "scaffolds the box installation rather than its content" },
  { name: "upgrade", audience: "engine", reason: "bumps the box's engine dependency; an installation act" },
  { name: "migrate", audience: "engine", reason: "applies data migrations to the installation; deploy sweeps every box" },
  { name: "field-test", audience: "engine", reason: "the agent field-test harness, run by a developer in this repo" },
];
