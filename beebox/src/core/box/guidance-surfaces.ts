/**
 * The registry of box guidance surfaces: every file or file family a box
 * agent reads as instructions, with how eagerly it loads (tier), who writes
 * its bytes (class), what installs it, and whether box git tracks it.
 *
 * This module is data plus path matching, with no installer imports, so
 * `install-template-file.ts` can derive the sync commit's managed paths from
 * it without pulling template bodies or generators into every consumer.
 * `syncBoxGuidance` (`guidance-sync.ts`) walks the rows. Reference:
 * `docs/box-guidance.md`.
 */

import type { TEMPLATE_STOCK_HASHES } from "../template-stock-hashes.js";
import { CLAUDE_MD, instructionSiblingPath } from "../agent-instruction-files.js";

/** How eagerly a host loads the surface (the `bbx-context` skill's router axis). */
export type GuidanceTier = "always" | "situational" | "invoked" | "on-demand" | "mirror";

/**
 * Who writes the bytes. `generated`: the engine rewrites it on every sync and
 * marks it with a DOCID line. `tracked`: the engine seeds it from a stock
 * template and the box may edit it (the template tracker parks updates on
 * edits). `package`: shipped in `node_modules/beebox/`, never in the box tree.
 * `owned`: the box writes it.
 */
export type GuidanceClass = "generated" | "tracked" | "package" | "owned";

/** A `MANAGED_STOCK_TEMPLATES` entry, keyed by its stock-hash ledger name. */
export type StockTemplateName = keyof typeof TEMPLATE_STOCK_HASHES;

/** Generators `syncBoxGuidance` runs; each returns its prune manifest (`generateSkills` also returns its conflicts). */
export type GuidanceGenerator = "generateRules" | "generateSkills";

/** Writers that run outside the `syncBoxGuidance` walk. */
type GuidanceOwner =
  | "box"
  | "ensureAgentContext"
  | "generateDocs"
  | "compileBriefings"
  | "compileGuides"
  | "installValidationHooks"
  | "installProcedures"
  | "installGuides"
  | "installPersonality"
  | "installBriefing"
  | "installSchedules"
  | "ensureEngineDocs"
  | "refreshMaps"
  | "generateAgentContextMirrors";

export type GuidanceInstall =
  /** The walk installs it through the template tracker. */
  | { via: "tracker"; template: StockTemplateName }
  /** The walk runs this generator once. */
  | { via: "generator"; generator: GuidanceGenerator }
  /**
   * Installed outside the walk: by a card installer with its own merge policy,
   * by a later `generateDocs` phase that needs compiled box state, by the
   * package build, or by the box.
   */
  | { via: "owner"; owner: GuidanceOwner; template?: StockTemplateName };

export interface GuidanceSurface {
  /**
   * Box-relative path. `<name>` stands for one path segment (or part of one);
   * a leading `**` + `/` stands for any directory prefix, including none.
   */
  path: string;
  tier: GuidanceTier;
  class: GuidanceClass;
  install: GuidanceInstall;
  /** Whether box git tracks it (`.gitignore` excludes `.beebox/` and `_content/docs/generated/`). */
  gitTracked: boolean;
}

const owner = (name: GuidanceOwner, template?: StockTemplateName): GuidanceInstall =>
  template === undefined ? { via: "owner", owner: name } : { via: "owner", owner: name, template };
const tracker = (template: StockTemplateName): GuidanceInstall => ({ via: "tracker", template });
const generator = (name: GuidanceGenerator): GuidanceInstall => ({ via: "generator", generator: name });

/** Every guidance surface, grouped by tier. */
export const GUIDANCE_SURFACES: readonly GuidanceSurface[] = [
  // always: loaded every turn through the root AGENTS.md and its includes.
  // The engine maintains only the root file's `@` include lines. Instruction
  // rows name `AGENTS.md`; a box not yet converted keeps `CLAUDE.md` at the
  // same place (`instructionFilePath`), and `guidanceSurfaceFor` maps it here.
  { path: "AGENTS.md", tier: "always", class: "owned", install: owner("ensureAgentContext"), gitTracked: true },
  { path: ".beebox/agent-guide.md", tier: "always", class: "generated", install: owner("generateDocs"), gitTracked: false },
  { path: "_content/briefing.md", tier: "always", class: "generated", install: owner("compileBriefings"), gitTracked: true },
  { path: "_content/briefing.briefing.card", tier: "always", class: "tracked", install: owner("installBriefing", "briefing-seed"), gitTracked: true },
  { path: "_config/main.personality.card", tier: "always", class: "tracked", install: owner("installPersonality"), gitTracked: true },

  // situational: loaded when the agent works on matching paths.
  { path: "src/schemas/AGENTS.md", tier: "situational", class: "tracked", install: tracker("schemas-guide-v2"), gitTracked: true },
  { path: "src/views/AGENTS.md", tier: "situational", class: "tracked", install: tracker("views-guide-v2"), gitTracked: true },
  { path: "src/tricks/scripts/AGENTS.md", tier: "situational", class: "tracked", install: tracker("tricks-guide-v2"), gitTracked: true },
  { path: "_config/feedback/AGENTS.md", tier: "situational", class: "tracked", install: tracker("agent-feedback-guide"), gitTracked: true },
  // Directory maps: an agent writes MAP.md in the refresh-maps procedure, and
  // the finalize step adds an `@MAP.md` include to the directory's instruction file.
  { path: "**/MAP.md", tier: "situational", class: "owned", install: owner("refreshMaps"), gitTracked: true },
  { path: ".claude/rules/card-<type>.md", tier: "situational", class: "generated", install: generator("generateRules"), gitTracked: true },
  { path: ".claude/rules/connector-<name>.md", tier: "situational", class: "generated", install: generator("generateRules"), gitTracked: true },
  { path: ".claude/rules/bbx-validate-ignore.md", tier: "situational", class: "generated", install: owner("installValidationHooks"), gitTracked: true },
  { path: ".claude/rules/guides-for-<type>.md", tier: "situational", class: "generated", install: owner("compileGuides"), gitTracked: true },
  { path: ".claude/rules/guide-for-chat-<chat>.md", tier: "situational", class: "generated", install: owner("compileGuides"), gitTracked: true },

  // invoked: loaded by name when a task calls for it.
  { path: ".claude/skills/<skill>/<file>", tier: "invoked", class: "generated", install: generator("generateSkills"), gitTracked: true },
  { path: "_config/procedures/<name>.procedure.card", tier: "invoked", class: "tracked", install: owner("installProcedures"), gitTracked: true },
  { path: "_config/<domain>.guide.card", tier: "invoked", class: "tracked", install: owner("installGuides"), gitTracked: true },
  { path: "_config/schedules/<name>.scheduled-script.card", tier: "invoked", class: "tracked", install: owner("installSchedules"), gitTracked: true },

  // on-demand: opened by path when an instruction points at it.
  { path: "node_modules/beebox/box-docs/<doc>.md", tier: "on-demand", class: "package", install: owner("ensureEngineDocs"), gitTracked: false },
  { path: "_content/docs/generated/<doc>.md", tier: "on-demand", class: "generated", install: owner("generateDocs"), gitTracked: false },

  // mirror: Codex's view of the Claude surfaces above. `**/AGENTS.md` is the
  // symlink beside each legacy `CLAUDE.md` in a box not yet converted.
  { path: "**/AGENTS.md", tier: "mirror", class: "generated", install: owner("generateAgentContextMirrors"), gitTracked: true },
  { path: ".agents/skills/beebox-rule-<rule>/SKILL.md", tier: "mirror", class: "generated", install: owner("generateAgentContextMirrors"), gitTracked: true },
  { path: ".agents/skills/<skill>", tier: "mirror", class: "generated", install: owner("generateAgentContextMirrors"), gitTracked: true },
  { path: ".codex/hooks.json", tier: "mirror", class: "generated", install: owner("generateAgentContextMirrors"), gitTracked: true },
];

/** Compile a registry path into an anchored regular expression. */
export function guidancePathPattern(surfacePath: string): RegExp {
  const source = surfacePath
    .split(/(<[a-z]+>|\*\*\/)/)
    .map((part) => {
      if (part === "**/") return "(?:.+/)?";
      if (/^<[a-z]+>$/.test(part)) return "[^/]+";
      return part.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
    })
    .join("");
  // eslint-disable-next-line security/detect-non-literal-regexp -- built from the in-code registry rows above with every metacharacter escaped; the only inserted classes are `[^/]+` and `(?:.+/)?`.
  return new RegExp(`^${source}$`);
}

function firstMatch(relPath: string): GuidanceSurface | undefined {
  return GUIDANCE_SURFACES.find((row) => guidancePathPattern(row.path).test(relPath));
}

/**
 * The first row whose path matches `relPath`, or undefined when none does. A
 * legacy `<dir>/CLAUDE.md` gets the row of its `<dir>/AGENTS.md` sibling,
 * except the mirror row, which describes the symlink and not the file.
 */
export function guidanceSurfaceFor(relPath: string): GuidanceSurface | undefined {
  const row = firstMatch(relPath);
  const sibling = instructionSiblingPath(relPath);
  if (row !== undefined || sibling === null || !relPath.endsWith(CLAUDE_MD)) return row;
  const legacy = firstMatch(sibling);
  return legacy?.tier === "mirror" ? undefined : legacy;
}
