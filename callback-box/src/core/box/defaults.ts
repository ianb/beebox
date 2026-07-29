/**
 * Default-card installers for `cb init`.
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
import { installTemplateFile, type InstallResult } from "../install-template-file.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

/**
 * Translate a single-template install result into the legacy `installed[]`
 * string that the `cb init` UI prints. `fresh` and `overwritten` outcomes
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
    const result = await installTemplateFile({
      boxRoot,
      relPath: path.join(BOX_DIRS.procedures, file),
      templateContent,
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
  const templateContent = createLandmarkTemplate({ label: "Box", symbol: "📦" });
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
 * Every box gets a briefing.briefing.card at the root.
 *
 * @returns Whether a new template was installed
 */
export async function installBriefing(boxRoot: string): Promise<boolean> {
  const result = await installTemplateFile({
    boxRoot,
    relPath: "briefing.briefing.card",
    templateContent: createBriefingTemplate(),
  });
  return result.outcome === "fresh";
}

/**
 * Install the box-wide `todo-view` stock instance if missing
 * (`docs/plans/todo-annotation.md` Track 4's "provisioned, not just
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
  enabled?: boolean;
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
    runs: "cb wakeup --connector gmail",
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
    runs: "cb wakeup --connector google-calendar",
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
    runs: "cb procedure run refresh-maps",
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
    runs: "cb procedure gc",
    source: "Daily sweep; each run card carries its own expires stamp",
  },
  {
    name: "process-retrospective",
    description:
      "Weekly retrospective: mine chat sessions for what the boxholder taught the agent, integrate into personality/guide cards",
    cron: "0 7 * * 1",
    notBefore: "3d",
    onWakeup: false,
    // Ships ENABLED for ALL boxes, deliberately. generateDocs() re-syncs
    // templates on every reactor cycle and chat-session start, so this flips
    // retro on for every box (overwriting unmodified disabled cards, installing
    // it fresh-and-enabled where absent). It's a weekly no-op on boxes with no
    // qualifying chat sessions — both the scan and integrate prechecks hit
    // CHECK_SKIP and invoke no agent — and only edits belief cards (a reviewable
    // Retro-Run commit) when there's real signal. medium is the inferred
    // ceiling; user-stated beliefs, speaking-voice, and the briefing body are
    // never direct-edited.
    enabled: true,
    lockGroup: "retro",
    runs: "cb procedure run process-retrospective",
    source: "Weekly Monday-morning sweep; enable per box once trialed",
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
