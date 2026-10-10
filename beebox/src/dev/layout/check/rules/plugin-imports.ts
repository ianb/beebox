/**
 * Rule plugin-imports (`docs/plans/plugins.md`, Track 1): a file under
 * `src/plugins/<name>/` may import only `src/exports/*`,
 * `src/cards/plugin-definition.ts`, its own directory, and packages, type
 * imports included (the plugin's emitted `.d.ts` would otherwise name
 * engine internals the package does not ship). `view.tsx`, and every own
 * module it reaches, may not import a Node builtin: it is bundled for the
 * browser. `eslint.config.ts` mirrors the rule for the editor.
 */
import { isBuiltin } from "node:module";
import type { Finding, LayoutRule, ModuleFile, PackageLayout } from "../../model.js";
import { dirOf, isWithin, modules } from "../../graph.js";

const VIEW_ENTRY = "view.tsx";

/** `<sourceRoot>/plugins/<name>` for a file inside a plugin directory, else null. */
function pluginDirOf(layout: PackageLayout, path: string): string | null {
  const pluginsDir = `${layout.sourceRoot}/plugins`;
  if (!isWithin(path, pluginsDir) || path === pluginsDir) return null;
  const rest = path.slice(pluginsDir.length + 1);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return `${pluginsDir}/${rest.slice(0, slash)}`;
}

function isAllowedTarget(params: { layout: PackageLayout; pluginDir: string; target: string }): boolean {
  const { layout, pluginDir, target } = params;
  return (
    isWithin(target, pluginDir) ||
    dirOf(target) === `${layout.sourceRoot}/exports` ||
    target === `${layout.sourceRoot}/cards/plugin-definition.ts`
  );
}

/** The view entry plus every own-directory module it reaches. */
function viewGraph(params: { byPath: Map<string, ModuleFile>; pluginDir: string }): Set<string> {
  const { byPath, pluginDir } = params;
  const entry = `${pluginDir}/${VIEW_ENTRY}`;
  const reached = new Set<string>();
  if (!byPath.has(entry)) return reached;
  const stack = [entry];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || reached.has(current)) continue;
    reached.add(current);
    for (const edge of byPath.get(current)?.imports ?? []) {
      if (edge.target !== null && isWithin(edge.target, pluginDir)) stack.push(edge.target);
    }
  }
  return reached;
}

function fileFindings(params: {
  layout: PackageLayout;
  file: ModuleFile;
  pluginDir: string;
  inViewGraph: boolean;
}): Finding[] {
  const { layout, file, pluginDir, inViewGraph } = params;
  const name = pluginDir.slice(pluginDir.lastIndexOf("/") + 1);
  const findings: Finding[] = [];
  for (const edge of file.imports) {
    if (edge.target !== null && !isAllowedTarget({ layout, pluginDir, target: edge.target })) {
      findings.push({
        rule: "plugin-imports",
        path: file.path,
        message:
          `imports ${edge.target} from plugin "${name}"; a plugin file imports only ${layout.sourceRoot}/exports/*, ` +
          `${layout.sourceRoot}/cards/plugin-definition.ts, its own directory, and packages`,
      });
    }
    if (inViewGraph && edge.external && isBuiltin(edge.specifier)) {
      findings.push({
        rule: "plugin-imports",
        path: file.path,
        message: `imports the Node builtin ${edge.specifier} in plugin "${name}"'s view graph; ${VIEW_ENTRY} and what it reaches are bundled for the browser`,
      });
    }
  }
  return findings;
}

function byPathThenMessage(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export const pluginImportsRule: LayoutRule = {
  description:
    "a plugin file imports only src/exports/*, src/cards/plugin-definition.ts, its own directory, and packages; its view graph imports no Node builtin",
  check(layout: PackageLayout): Finding[] {
    const byPath = new Map(modules(layout).map((module) => [module.path, module]));
    const viewGraphs = new Map<string, Set<string>>();
    const findings: Finding[] = [];
    for (const file of byPath.values()) {
      const pluginDir = pluginDirOf(layout, file.path);
      if (pluginDir === null) continue;
      let graph = viewGraphs.get(pluginDir);
      if (graph === undefined) {
        graph = viewGraph({ byPath, pluginDir });
        viewGraphs.set(pluginDir, graph);
      }
      findings.push(...fileFindings({ layout, file, pluginDir, inViewGraph: graph.has(file.path) }));
    }
    return findings.toSorted(byPathThenMessage);
  },
};
