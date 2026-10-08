/**
 * Default-card installers for `bbx init`.
 *
 * These install the seed cards every box ships with — procedures, domain
 * guides, the personality card, the root landmark and briefing, and the
 * default scheduled scripts. All share the same update-or-preserve behavior
 * provided by `installTemplateFile`: a fresh box gets the canonical file, an
 * unmodified box gets the new template, and a user-modified file gets the new
 * version parked under `_config/_template-updates/` for manual merging.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BOX_DIRS } from "../../../lib/paths/core.js";
import { createInitialGuideTemplate } from "../../../schemas/guide/templates.js";
import { createScheduledScriptTemplate, ScheduledScriptSchema } from "../../../schemas/scheduled-script/schema.js";
import { createInitialPersonalityTemplate } from "../../../schemas/personality/schema.js";
import { createBriefingTemplate } from "../../../schemas/briefing.js";
import { createTodoViewTemplate } from "../../../schemas/todo-view.js";
import { PLATE_CARD_PATH } from "../../../shared/todo-model.js";
import { createLandmarkTemplate, parseLandmarkFields, STOCK_ROOT_OPENERS } from "../../../schemas/landmark.js";
import {
  hasRecordedTemplateVersion,
  installTemplateFile,
  type InstallResult,
} from "../../install-template-file.js";
import { TEMPLATE_STOCK_HASHES } from "../../template-stock-hashes.js";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { boxSlug } from "../../../lib/box-slug.js";

/**
 * Translate a single-template install result into the legacy `installed[]`
 * string that the `bbx init` UI prints. `fresh` and `overwritten` outcomes
 * surface the canonical filename; `parked` surfaces the
 * `_template-updates/...` path with an "(update available)" hint; other
 * outcomes (`unchanged`, `skipped`) produce no entry.
 */
function describeInstall(result: InstallResult, displayName: string): string | null {
  if (result.outcome === "fresh") return displayName;
  if (result.outcome === "overwritten") return `${displayName} (updated)`;
  if (result.outcome === "parked") return `${result.writtenAt} (update available)`;
  return null;
}

/**
 * The `priorStockHashes` option for one install: `hashes` only when the box has
 * no recorded version of `relPath` (the bootstrap case), for the reason given
 * at {@link PRIOR_STOCK_PROCEDURE_HASHES}.
 */
async function priorStockOption(
  boxRoot: string,
  { relPath, hashes }: { relPath: string; hashes: string[] | undefined },
): Promise<{ priorStockHashes?: string[] }> {
  if (hashes === undefined || (await hasRecordedTemplateVersion(boxRoot, relPath))) return {};
  return { priorStockHashes: hashes };
}

/**
 * Install procedure templates into a box.
 *
 * On fresh install: copies template procedure cards to _config/procedures/.
 * On update: if the box's copy matches the previously installed version,
 * updates it. If the box's copy has been modified, writes the new version
 * into `_config/_template-updates/procedures/` for manual merging.
 *
 * @returns List of installed/updated procedure names
 */
/**
 * Stock procedure-card hashes that predate `config/template-versions.json`
 * tracking for procedures, keyed by template filename.
 *
 * Without these, a box whose copy was installed before procedures were tracked
 * has no recorded hash, so any upstream change parks in
 * `_config/_template-updates/` instead of landing — silently, since a parked
 * update is not an error. The boxes running a procedure most are the oldest
 * ones, i.e. exactly the ones that park.
 *
 * Every hash here was verified against a real field copy whose box-side git
 * history shows no human or agent edit — only the automated `box-packageify`
 * migration, which rewrote paths inside the card. They are canonical hashes
 * (the same `sha256(canonicalize(...))` {@link installTemplateFile} computes);
 * procedures declare no `boxOwnedFields` and no `normalize`, so that is the
 * file hash. Add to this list only for a copy you have likewise shown to be
 * unedited stock — a wrong entry here silently overwrites someone's work.
 *
 * Applied ONLY to a box with no recorded version for the file — the bootstrap
 * case above. A tracked box that diverged from its recorded hash has been
 * edited by someone, and an edit that happens to land on old stock content
 * (reverting a prompt on purpose, say) is still their choice to keep. Without
 * this scoping, `installTemplateFile` would overwrite it, since it accepts a
 * prior-stock match whether or not a recorded hash exists.
 */
const PRIOR_STOCK_PROCEDURE_HASHES: Readonly<Record<string, string[]>> = {
  "refresh-maps.procedure.card": [
    // Field copies as of 2026-08-24: two boxes share the first, one carries
    // the second. Both are pre-tracking stock mutated only by box-packageify.
    "22359ef58fe4fecda2bb8e7ce12fcbd511df4edaf4e30d5befbf6ae9f3474a47",
    "3fcb0dd508a76194ff1cd6af2d222a953a651d58f9846304e42ae3c5bb1e8a99",
  ],
  // The shipped template from before its belief `source` became `basis`
  // (2026-09): our own output, so an untracked copy of it is unedited stock.
  "process-retrospective.procedure.card": [
    "4c11a4c3e1ef14da3154ebc7c218f270cda69ca195360cc2a60af1e949b9def1",
  ],
};

export async function installProcedures(boxRoot: string): Promise<string[]> {
  const templatesDir = path.join(PACKAGE_ROOT, "templates", "procedures");

  let templateFiles: string[];
  try {
    templateFiles = (await fs.readdir(templatesDir)).filter((f) =>
      f.endsWith(".procedure.card")
    );
  } catch (e) {
    // No procedure templates to install (dir missing, or unreadable). Skip
    // installing rather than fail init, but log so a misconfigured package
    // layout doesn't silently drop all default procedures.
    console.warn(`Could not read procedure templates from ${templatesDir}:`, e);
    return [];
  }

  const installed: string[] = [];
  for (const file of templateFiles) {
    const templateContent = await fs.readFile(path.join(templatesDir, file), "utf-8");
    const relPath = path.join(BOX_DIRS.procedures, file);
    const result = await installTemplateFile({
      boxRoot,
      relPath,
      templateContent,
      ...(await priorStockOption(boxRoot, { relPath, hashes: PRIOR_STOCK_PROCEDURE_HASHES[file] })),
    });
    const entry = describeInstall(result, file);
    if (entry !== null) installed.push(entry);
  }
  return installed;
}

/** Known guide domains that get default templates */
const GUIDE_DOMAINS = ["intake", "calendar"];

/**
 * Earlier stock guide hashes, keyed by filename: from before experiments lost
 * `status`, and (intake, the one with triage rules) from before a rule's
 * `source` became `basis` (both 2026-09). A tracked box needs none of these:
 * its recorded hash already marks an old stock copy as ours, and the
 * `status-fields-2026-09` and `source-fields-2026-09` migrations turn an old
 * stock copy into exactly the current template. They cover an untracked box
 * whose install runs before those migrations, so its unedited copy updates
 * instead of parking. Applied only to a box with no recorded version, for the
 * reason given at {@link PRIOR_STOCK_PROCEDURE_HASHES}.
 */
const PRIOR_STOCK_GUIDE_HASHES: Readonly<Record<string, string[]>> = {
  "intake.guide.card": [
    "02e0c866f365c6898d4983851492fa1573c9bbd9a91503c3d31078cca541e30a",
    "1e172c1d28b95e21c2a3fd721b87f5fe51f459fb2125356540064f1c09a3cb42",
  ],
  "calendar.guide.card": ["cba0c1ae68ff656611b5b9b6b3be9ca65233b1bf1c913b3ce62d395bf234da99"],
};

/**
 * Install default guide cards into a box.
 *
 * On fresh install: writes default guide cards to config/.
 * On update: if the box's copy matches the template, overwrites it with the
 * latest template. If the user has modified the guide, parks the new template
 * under `_config/_template-updates/` for manual merging. (Guide templates carry
 * no timestamps, so an unmodified guide compares byte-equal across runs — the
 * former created-at churn is gone.)
 *
 * @returns List of installed/updated guide names
 */
export async function installGuides(boxRoot: string): Promise<string[]> {
  const installed: string[] = [];
  for (const domain of GUIDE_DOMAINS) {
    const fileName = `${domain}.guide.card`;
    const templateContent = createInitialGuideTemplate({ name: domain });
    const relPath = path.join(BOX_DIRS.config, fileName);
    const result = await installTemplateFile({
      boxRoot,
      relPath,
      templateContent,
      ...(await priorStockOption(boxRoot, { relPath, hashes: PRIOR_STOCK_GUIDE_HASHES[fileName] })),
    });
    const entry = describeInstall(result, fileName);
    if (entry !== null) installed.push(entry);
  }
  return installed;
}

/**
 * Install the personality card template if missing.
 *
 * Unlike guides (which have domain seeds), there's only one personality
 * card per box: config/main.personality.card.
 *
 * @returns Whether a new template was installed
 */
export async function installPersonality(boxRoot: string): Promise<boolean> {
  const result = await installTemplateFile({
    boxRoot,
    relPath: path.join(BOX_DIRS.config, "main.personality.card"),
    templateContent: createInitialPersonalityTemplate(),
  });
  return result.outcome === "fresh";
}

/**
 * Ensure the box root has a usable landmark card. The root landmark is
 * "magical" — it always needs to exist on the Landmarks page so chats can be
 * bound to the box root. We install one when the root has no `*.landmark.card`
 * at all, AND repair one that exists but is *inert* — carries no real role
 * (navigation / destinations), e.g. an un-migrated XML-body card or one whose
 * roles were stripped. An inert root landmark otherwise sits on the Landmarks
 * page with no symbol and a filename-fallback label, and never self-heals
 * because a file is technically present. A landmark with a real role is left
 * untouched (the user owns its label, symbol, links, etc.).
 *
 * @returns The box-relative path of the landmark created or repaired (so the
 *   caller can commit it), or null if a real landmark was already present.
 */
export async function installRootLandmark(boxRoot: string): Promise<string | null> {
  const contentDir = path.join(boxRoot, "_content");
  let entries: string[];
  try {
    entries = await fs.readdir(contentDir);
  } catch (e) {
    // Can't list the content root — skip installing the root landmark rather
    // than fail, but log: an unreadable content root is unexpected here.
    console.warn(`Could not read box content root ${contentDir} for landmark check:`, e);
    return null;
  }
  // Named for the box, not the literal word "Box": this label is the box's
  // display name everywhere it is named -- the box switcher, the dashboard
  // header, the browser tab -- so a fleet scaffolded with one hardcoded label
  // is a fleet whose boxes all look alike in a tab strip. The boxholder
  // renames it by editing the card, like any other box fact.
  // The root place carries the box's onboarding openers; the agent fades them
  // as the box comes into use (docs/plans/landmark-arrival.md, Track B).
  const templateContent = createLandmarkTemplate({ label: await boxSlug(boxRoot), symbol: "📦", openers: STOCK_ROOT_OPENERS });
  const existing = entries.find((name) => name.endsWith(".landmark.card"));
  if (existing !== undefined) {
    const existingRelPath = path.join("_content", existing);
    let hasRole: boolean;
    try {
      const fields = parseLandmarkFields(await fs.readFile(path.join(contentDir, existing), "utf-8"));
      hasRole = fields !== null && (fields.navigation !== undefined || (fields.destinations?.length ?? 0) > 0);
    } catch (e) {
      console.warn(`Could not read root landmark ${existing} in ${contentDir}:`, e);
      return null;
    }
    if (hasRole) return null; // a real landmark — leave the user's content alone
    // Inert/unparseable — repair in place, preserving the existing filename.
    await fs.writeFile(path.join(contentDir, existing), templateContent);
    return existingRelPath;
  }

  const result = await installTemplateFile({
    boxRoot,
    relPath: "_content/Box.landmark.card",
    templateContent,
  });
  return result.outcome === "fresh" ? "_content/Box.landmark.card" : null;
}

/**
 * Install the root briefing card template if missing.
 *
 * Every box gets a briefing.briefing.card at the root. It goes through the
 * template tracker with the stock-hash allowlist, so a box still carrying an
 * untouched earlier seed (e.g. the pre-`{% opener %}` one) takes the update
 * instead of parking it, while a briefing the boxholder or an agent has
 * written into parks as usual — which is the normal case for any box past
 * its first day.
 *
 * @returns Whether a new template was installed
 */
export async function installBriefing(boxRoot: string): Promise<boolean> {
  const result = await installTemplateFile({
    boxRoot,
    relPath: "_content/briefing.briefing.card",
    templateContent: createBriefingTemplate(),
    priorStockHashes: TEMPLATE_STOCK_HASHES["briefing-seed"].superseded,
  });
  return result.outcome === "fresh";
}

/**
 * Install the box-wide `todo-view` stock instance if missing
 * (`docs/implemented-plans/todo-annotation.md` Track 4's "provisioned, not just
 * templated" pin): `_content/plate.todo-view.card`, explicit `glob: "**"` so
 * it stays box-wide even though it doesn't live at the box root (an omitted
 * `glob` would scope to `store/**` per the query's directory-subtree
 * resolution rule — this card wants the whole box).
 *
 * @returns Whether a new template was installed
 */
export async function installTodoView(boxRoot: string): Promise<boolean> {
  const result = await installTemplateFile({
    boxRoot,
    relPath: PLATE_CARD_PATH,
    templateContent: createTodoViewTemplate({ glob: "**", title: "The Plate" }),
  });
  return result.outcome === "fresh";
}

// ============================================
// Default scheduled scripts
// ============================================

interface DefaultSchedule {
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

const DEFAULT_SCHEDULES: DefaultSchedule[] = [
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
    // discovery counts a session only when its transcript carries `<typed>`/
    // `<speech>`-tagged messages or the session is in the chat registry, so
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
      "Daily todo review: an agent gives each escalated, newly-on-plate, or stale todo a status change or a recheck date",
    cron: "30 6 * * *",
    notBefore: "20h",
    onWakeup: false,
    // Seeded ENABLED (boxholder, 2026-09-24, docs/plans/todos-ui.md Track 7).
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

/**
 * Stock schedule hashes from before `source` became `reason` (2026-09), keyed
 * by filename. Canonical hashes: `enabled` is box-owned and stripped. Same
 * role as {@link PRIOR_STOCK_GUIDE_HASHES}: the `source-fields-2026-09`
 * migration turns an old stock copy into exactly the current template, and
 * these let an untracked box whose install runs first update instead of
 * parking.
 */
const PRIOR_STOCK_SCHEDULE_HASHES: Readonly<Record<string, string[]>> = {
  "check-email.scheduled-script.card": ["5c5db53b3ea8b53aa65d0f3c20b9a84d89d78f0dfc55b545308f5b7d7a7ea736"],
  "check-calendar.scheduled-script.card": ["3be5c5339dfc63b1b77556d16447ec8a3ea721ab52aaeb123cdfe5d4be0f6073"],
  "check-drive.scheduled-script.card": ["7ea0ebc1b3837229d1adda17e1949686868e944d31dfcc8d39b56c21eabd1354"],
  "refresh-maps.scheduled-script.card": ["b9aa76676eb7b9bcc506f0b135a70025c4dfa615fd53d5787abacec86c8ed220"],
  "gc-procedure-runs.scheduled-script.card": ["4272c1b1da2a6e7a9c3acf94aca3f644d75a79c69274b21db4dd8ed68f967ea6"],
  "process-retrospective.scheduled-script.card": ["e311bd5da27e50bdf7793d62cc88123695f696cc0fafe744a5fef813533493c8"],
  "todo-review.scheduled-script.card": ["dad98103bd3cc7d7fd8d4755a9335a929c69e0000d82f951b8e519bb7106547e"],
  "chat-review.scheduled-script.card": ["2ff5b6972353807b8af43602da82e8f75862c5ebcacec232726da77f71be1a2b"],
};

/**
 * Install default scheduled-script cards into a box.
 *
 * Same update-or-preserve pattern as procedures and guides.
 *
 * @returns List of installed/updated schedule names
 */
export async function installSchedules(boxRoot: string): Promise<string[]> {
  const installed: string[] = [];
  for (const sched of DEFAULT_SCHEDULES) {
    const fileName = `${sched.name}.scheduled-script.card`;
    const templateContent = createScheduledScriptTemplate({
      ...(sched.cron && { cron: sched.cron }),
      ...(sched.notBefore && { notBefore: sched.notBefore }),
      ...(sched.onWakeup && { onWakeup: sched.onWakeup }),
      ...(sched.createAfterSuccess && { createAfterSuccess: sched.createAfterSuccess }),
      ...(sched.lockGroup && { lockGroup: sched.lockGroup }),
      ...(sched.timeout && { timeout: sched.timeout }),
      ...(sched.enabled === false && { enabled: false }),
      ...(sched.requires && sched.requires.length > 0 && { requires: sched.requires }),
      runs: sched.runs,
      description: sched.description,
      reason: sched.reason,
    });
    const relPath = path.join(BOX_DIRS.schedules, fileName);
    const result = await installTemplateFile({
      boxRoot,
      relPath,
      templateContent,
      ...(ScheduledScriptSchema.templateMerge && {
        boxOwnedFields: ScheduledScriptSchema.templateMerge.boxOwnedFields,
      }),
      ...(await priorStockOption(boxRoot, { relPath, hashes: PRIOR_STOCK_SCHEDULE_HASHES[fileName] })),
    });
    const entry = describeInstall(result, fileName);
    if (entry !== null) installed.push(entry);
  }
  return installed;
}
