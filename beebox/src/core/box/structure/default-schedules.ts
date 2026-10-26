/**
 * The stock scheduled scripts a box is seeded with (`installSchedules` in
 * `defaults.ts` writes them as `_config/schedules/*.scheduled-script.card`).
 */

export interface DefaultSchedule {
  name: string;
  description: string;
  cron?: string;
  notBefore?: string;
  onWakeup?: boolean;
  runs: string;
  reason: string;
  createAfterSuccess?: Array<{ path: string; args: Record<string, string> }>;
  lockGroup?: string;
  timeout?: string;
  /** Every seeded schedule declares its initial state; true is omitted from cards. */
  enabled: boolean;
  requires?: string[];
}

export const DEFAULT_SCHEDULES: DefaultSchedule[] = [
  {
    name: "check-email",
    description: "Pull new emails from Gmail for triage and response",
    cron: "*/15 * * * *",
    notBefore: "10m",
    onWakeup: true,
    enabled: false,
    runs: "bbx engine wakeup --connector gmail",
    reason: "Check email frequently during active hours",
    requires: ["gmail"],
  },
  {
    name: "check-calendar",
    description: "Sync Google Calendar events and detect changes",
    cron: "0 * * * *",
    notBefore: "30m",
    onWakeup: true,
    enabled: false,
    runs: "bbx engine wakeup --connector google-calendar",
    reason: "Sync calendar changes hourly",
    requires: ["google"],
  },
  {
    name: "check-drive",
    description: "Sync mounted Google Drive files and folders",
    cron: "0 * * * *",
    notBefore: "30m",
    onWakeup: true,
    enabled: false,
    // The connector registers under `google-drive` (`connectors/google-drive.ts`),
    // and `--connector` matches the registered name exactly; `drive` would
    // report "Connector not found" every hour.
    runs: "bbx engine wakeup --connector google-drive",
    reason: "Sync Drive mounts hourly",
    // `drive`, not `google` — the latter is the legacy alias for calendar
    // (`connectors/requirements.ts`).
    requires: ["drive"],
  },
  {
    name: "refresh-maps",
    description: "Refresh MAP.md files when files or directories were added/deleted",
    cron: "0 5 * * *",
    notBefore: "20h",
    onWakeup: false,
    enabled: true,
    runs: "bbx procedure run refresh-maps",
    reason: "Daily check; precheck no-ops when nothing changed",
  },
  {
    name: "gc-procedure-runs",
    description:
      "Delete expired procedure run directories (run dirs are a recent cache — git history is the archive)",
    cron: "0 6 * * *",
    notBefore: "20h",
    onWakeup: false,
    enabled: true,
    runs: "bbx procedure gc",
    reason: "Daily sweep; each run card carries its own expires stamp",
  },
  {
    name: "process-retrospective",
    description:
      "Weekly retrospective: mine chat sessions for what the boxholder taught the agent, integrate into personality/guide cards",
    cron: "0 7 * * 1",
    notBefore: "3d",
    onWakeup: false,
    // Seeded ENABLED. The quota worry that had this off doesn't hold: retro
    // only spawns an agent once a HUMAN chat session has gone quiet — retro
    // discovery counts a session only when its transcript carries human-input
    // tags (`<typed>`, `<speech>`, or `<external-input>`) or is in the registry, so
    // wakeup, job, and procedure transcripts classify as nonChat — and with
    // nothing qualifying, the scan step's precheck exits CHECK_SKIP and no
    // agent runs. On a box nobody chats with, this costs nothing. `enabled` is
    // a box-owned field (ScheduledScriptSchema.templateMerge), so an existing
    // box keeps whatever it has set; this default reaches new boxes only.
    enabled: true,
    lockGroup: "retro",
    runs: "bbx procedure run process-retrospective",
    reason: "Weekly Monday-morning sweep over any chat sessions that went quiet",
  },
  {
    name: "todo-review",
    description:
      "Daily todo review: an agent gives each overdue, newly started, or stale todo a status change or a recheck date",
    cron: "30 6 * * *",
    notBefore: "20h",
    onWakeup: false,
    // Seeded ENABLED (boxholder, 2026-09-24, docs/implemented-plans/todos-ui.md Track 7).
    // Like process-retrospective, the precheck exits CHECK_SKIP when no todo
    // needs review, so a quiet box runs no agent.
    enabled: true,
    // A 20-turn agent plus up to the engine's review retries; the scheduler's
    // 10m default would cut a retry short.
    timeout: "30m",
    runs: "bbx procedure run todo-review",
    reason: "Daily early-morning sweep; precheck no-ops when no todo needs review",
  },
  {
    name: "question-review",
    description:
      "Daily question review: an agent decides or asks again each question put away for 3 days or pending for 14",
    cron: "0 6 * * *",
    notBefore: "20h",
    onWakeup: false,
    // Seeded ENABLED (boxholder, 2026-10-26, docs/plans/questions-later-and-figure-it-out.md
    // open question 4), and installed into existing boxes. Like todo-review,
    // the precheck exits CHECK_SKIP when no question qualifies, so a quiet box
    // runs no agent.
    enabled: true,
    // A 20-turn agent plus up to the engine's review retries.
    timeout: "30m",
    runs: "bbx procedure run question-review",
    reason: "Daily early-morning sweep; precheck no-ops when no question needs review",
  },
  {
    name: "chat-review",
    description:
      "Nightly chat review: title and summarize chat sessions that have grown enough to be worth re-reading",
    cron: "0 4 * * *",
    notBefore: "20h",
    onWakeup: false,
    // Seeded disabled: chat review scans transcripts and writes generated
    // prose to git-tracked cards, so it must be explicitly opted into.
    enabled: false,
    // Shares retro's group: both walk every transcript under ~/.claude, and
    // there is no reason to have them do it concurrently.
    lockGroup: "retro",
    runs: "bbx chat review run",
    reason: "Nightly sweep; opt in per box",
  },
];
