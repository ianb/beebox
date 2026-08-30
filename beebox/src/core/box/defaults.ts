/**
 * Default-card installers for `bbx init`.
 *
 * These install the seed cards every box ships with — procedures, domain
 * guides, the personality card, the root landmark and briefing, and the
 * default scheduled scripts. All share the same update-or-preserve behavior
 * provided by `installTemplateFile`: a fresh box gets the canonical file, an
 * unmodified box gets the new template, and a user-modified file gets the new
 * version parked under `config/_template-updates/` for manual merging.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BOX_DIRS } from "../../lib/paths.js";
import { createInitialGuideTemplate } from "../../schemas/guide.js";
import { createScheduledScriptTemplate, ScheduledScriptSchema } from "../../schemas/scheduled-script.js";
import { createInitialPersonalityTemplate } from "../../schemas/personality.js";
import { createBriefingTemplate } from "../../schemas/briefing.js";
import { createTodoViewTemplate } from "../../schemas/todo-view.js";
import { createLandmarkTemplate, parseLandmarkFields } from "../../schemas/landmark.js";
import {
  hasRecordedTemplateVersion,
  installTemplateFile,
  type InstallResult,
} from "../install-template-file.js";
import { TEMPLATE_STOCK_HASHES } from "../template-stock-hashes.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { boxSlug } from "../../lib/box-slug.js";

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
 * Install procedure templates into a box.
 *
 * On fresh install: copies template procedure cards to config/procedures/.
 * On update: if the box's copy matches the previously installed version,
 * updates it. If the box's copy has been modified, writes the new version
 * into `config/_template-updates/procedures/` for manual merging.
 *
 * @returns List of installed/updated procedure names
 */
/**
 * Stock procedure-card hashes that predate `config/template-versions.json`
 * tracking for procedures, keyed by template filename.
 *
 * Without these, a box whose copy was installed before procedures were tracked
 * has no recorded hash, so any upstream change parks in
 * `config/_template-updates/` instead of landing — silently, since a parked
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
    const priorStock = PRIOR_STOCK_PROCEDURE_HASHES[file];
    const usePriorStock =
      priorStock !== undefined && !(await hasRecordedTemplateVersion(boxRoot, relPath));
    const result = await installTemplateFile({
      boxRoot,
      relPath,
      templateContent,
      ...(usePriorStock ? { priorStockHashes: priorStock } : {}),
    });
    const entry = describeInstall(result, file);
    if (entry !== null) installed.push(entry);
  }
  return installed;
}

/** Known guide domains that get default templates */
const GUIDE_DOMAINS = ["intake", "calendar"];

/**
 * Install default guide cards into a box.
 *
 * On fresh install: writes default guide cards to config/.
 * On update: if the box's copy matches the template, overwrites it with the
 * latest template. If the user has modified the guide, parks the new template
 * under `config/_template-updates/` for manual merging. (Guide templates carry
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
    const result = await installTemplateFile({
      boxRoot,
      relPath: path.join("config", fileName),
      templateContent,
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
    relPath: "config/main.personality.card",
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
  let entries: string[];
  try {
    entries = await fs.readdir(boxRoot);
  } catch (e) {
    // Can't list the box root — skip installing the root landmark rather
    // than fail, but log: an unreadable box root is unexpected here.
    console.warn(`Could not read box root ${boxRoot} for landmark check:`, e);
    return null;
  }
  // Named for the box, not the literal word "Box": this label is the box's
  // display name everywhere it is named -- the box switcher, the dashboard
  // header, the browser tab -- so a fleet scaffolded with one hardcoded label
  // is a fleet whose boxes all look alike in a tab strip. The boxholder
  // renames it by editing the card, like any other box fact.
  const templateContent = createLandmarkTemplate({ label: await boxSlug(boxRoot), symbol: "📦" });
  const existing = entries.find((name) => name.endsWith(".landmark.card"));
  if (existing !== undefined) {
    let hasRole: boolean;
    try {
      const fields = parseLandmarkFields(await fs.readFile(path.join(boxRoot, existing), "utf-8"));
      hasRole = fields !== null && (fields.navigation !== undefined || (fields.destinations?.length ?? 0) > 0);
    } catch (e) {
      console.warn(`Could not read root landmark ${existing} in ${boxRoot}:`, e);
      return null;
    }
    if (hasRole) return null; // a real landmark — leave the user's content alone
    // Inert/unparseable — repair in place, preserving the existing filename.
    await fs.writeFile(path.join(boxRoot, existing), templateContent);
    return existing;
  }

  const result = await installTemplateFile({
    boxRoot,
    relPath: "Box.landmark.card",
    templateContent,
  });
  return result.outcome === "fresh" ? "Box.landmark.card" : null;
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
    relPath: "briefing.briefing.card",
    templateContent: createBriefingTemplate(),
    priorStockHashes: TEMPLATE_STOCK_HASHES["briefing-seed"].superseded,
  });
  return result.outcome === "fresh";
}

/**
 * Install the box-wide `todo-view` stock instance if missing
 * (`docs/implemented-plans/todo-annotation.md` Track 4's "provisioned, not just
 * templated" pin): `store/plate.todo-view.card`, explicit `glob: "**"` so
 * it stays box-wide even though it doesn't live at the box root (an omitted
 * `glob` would scope to `store/**` per `todos.list`'s directory-subtree
 * resolution rule — this card wants the whole box).
 *
 * @returns Whether a new template was installed
 */
export async function installTodoView(boxRoot: string): Promise<boolean> {
  const result = await installTemplateFile({
    boxRoot,
    relPath: "store/plate.todo-view.card",
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
  source: string;
  createAfterSuccess?: Array<{ path: string; args: Record<string, string> }>;
  lockGroup?: string;
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
    runs: "bbx wakeup --connector gmail",
    source: "Check email frequently during active hours",
    requires: ["gmail"],
  },
  {
    name: "check-calendar",
    description: "Sync Google Calendar events and detect changes",
    cron: "0 * * * *",
    notBefore: "30m",
    onWakeup: true,
    enabled: false,
    runs: "bbx wakeup --connector google-calendar",
    source: "Sync calendar changes hourly",
    requires: ["google"],
  },
  {
    name: "refresh-maps",
    description: "Refresh MAP.md files when files or directories were added/deleted",
    cron: "0 5 * * *",
    notBefore: "20h",
    onWakeup: false,
    enabled: true,
    runs: "bbx procedure run refresh-maps",
    source: "Daily check; precheck no-ops when nothing changed",
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
    source: "Daily sweep; each run card carries its own expires stamp",
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
    source: "Weekly Monday-morning sweep over any chat sessions that went quiet",
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
    source: "Nightly sweep; opt in per box",
  },
];

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
      ...(sched.enabled === false && { enabled: false }),
      ...(sched.requires && sched.requires.length > 0 && { requires: sched.requires }),
      runs: sched.runs,
      description: sched.description,
      source: sched.source,
    });
    const result = await installTemplateFile({
      boxRoot,
      relPath: path.join("config/schedules", fileName),
      templateContent,
      ...(ScheduledScriptSchema.templateMerge && {
        boxOwnedFields: ScheduledScriptSchema.templateMerge.boxOwnedFields,
      }),
    });
    const entry = describeInstall(result, fileName);
    if (entry !== null) installed.push(entry);
  }
  return installed;
}
