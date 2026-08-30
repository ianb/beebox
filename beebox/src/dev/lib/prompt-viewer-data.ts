/**
 * Assemble the data model the prompt-viewer HTML page consumes: the static
 * inventory, the three assembled situations, a duplication report, a fragment
 * name index, and the numbers that feed the size ledger.
 *
 * All paths and prompt text are home-relativized (the home directory becomes
 * `~`) so nothing written to disk leaks an absolute home path.
 */

import { homedir } from "node:os";
import { assembleContext, wordCount, type LayerLoading } from "./context-assembly.js";
import { collectPrompts } from "./prompt-inventory.js";
import { estimateTokens, findDuplication, type DuplicationFinding, type Fragment } from "./duplication.js";
import { assertUniqueNames, inventoryName, layerName } from "./prompt-naming.js";

const SITUATION_ORDER = ["chat", "chat-thread", "reactor"] as const;

export interface LayerData {
  /** Stable kebab name, e.g. `chat/claude-md`. */
  name: string;
  /** Human-readable layer label from context-assembly. */
  label: string;
  source: string;
  loading: LayerLoading;
  words: number;
  tokens: number;
  text: string;
  /** Other fragment names sharing byte-identical text. */
  aliases: string[];
}

export interface SituationData {
  situation: string;
  description: string;
  layers: LayerData[];
  notRendered: string[];
}

export interface InventoryEntryData {
  name: string;
  title: string;
  category: string;
  source: string;
  scope: string;
  words: number;
  tokens: number;
  text: string;
  aliases: string[];
}

export interface FragmentIndexEntry {
  name: string;
  /** `inventory` or a situation name. */
  kind: string;
  aliases: string[];
}

export interface ViewerData {
  generatedAt: string;
  commit: string;
  box: string;
  situations: SituationData[];
  inventory: InventoryEntryData[];
  duplication: DuplicationFinding[];
  fragmentIndex: FragmentIndexEntry[];
}

export interface SituationSize {
  alwaysWords: number;
  alwaysTokens: number;
  totalWords: number;
  totalTokens: number;
}

export interface LedgerLine {
  at: string;
  commit: string;
  box: string;
  situations: Record<string, SituationSize>;
  fragments: Record<string, { words: number; tokens: number }>;
}

/** Replace a leading home-directory path with `~` so no absolute path leaks. */
export function relativizeHome(text: string): string {
  const home = homedir();
  if (home === "") return text;
  return text.split(home).join("~");
}

const INVENTORY_CATEGORIES: Array<{ category: string; test: (title: string) => boolean }> = [
  { category: "System prompts", test: (t) => /^(Reactor|Chat|Commit)/.test(t) },
  { category: "Subagent prompts", test: (t) => /^(Retro Observer|Scenario Validator|Procedure Judge|Triage)/.test(t) },
  { category: "Schemas", test: (t) => t.startsWith("Schema:") },
  { category: "Connector rules", test: (t) => t.startsWith("Connector") },
  { category: "Procedures", test: (t) => t.startsWith("Procedure:") },
  { category: "Procedure infrastructure", test: (t) => t.startsWith("Procedure Context") },
];

function categoryFor(title: string): string {
  for (const { category, test } of INVENTORY_CATEGORIES) {
    if (test(title)) return category;
  }
  return "Other";
}

interface NamedFragment extends Fragment {
  kind: string;
}

export interface BuildResult {
  data: ViewerData;
  ledgerContent: { situations: Record<string, SituationSize>; fragments: LedgerLine["fragments"] };
}

/** Build the full viewer data model + the numeric content that feeds the ledger. */
export async function buildViewerData(options: {
  box: string;
  commit: string;
  generatedAt: string;
}): Promise<BuildResult> {
  const { box, commit, generatedAt } = options;

  const entries = await collectPrompts();
  const situations = await Promise.all(
    SITUATION_ORDER.map(async (situation) => {
      const ctx = await assembleContext(situation, { boxRoot: box });
      return { situation, ctx };
    }),
  );

  // Every named fragment (inventory + all situation layers), pre-relativization,
  // so identical-text detection compares the true content.
  const allFragments: NamedFragment[] = [];
  for (const entry of entries) {
    allFragments.push({ name: inventoryName(entry.title), text: entry.text, kind: "inventory" });
  }
  for (const { situation, ctx } of situations) {
    for (const layer of ctx.layers) {
      allFragments.push({ name: layerName(situation, layer.name), text: layer.text, kind: situation });
    }
  }

  assertUniqueNames(allFragments.map((f) => f.name));

  // Group by identical text → aliases (other names sharing that text).
  const namesByText = new Map<string, string[]>();
  for (const fragment of allFragments) {
    const list = namesByText.get(fragment.text) ?? [];
    list.push(fragment.name);
    namesByText.set(fragment.text, list);
  }
  const aliasesFor = (name: string, text: string): string[] =>
    (namesByText.get(text) ?? []).filter((n) => n !== name);

  const inventory: InventoryEntryData[] = entries.map((entry) => {
    const name = inventoryName(entry.title);
    return {
      name,
      title: entry.title,
      category: categoryFor(entry.title),
      source: relativizeHome(entry.source),
      scope: entry.scope,
      words: wordCount(entry.text),
      tokens: estimateTokens(entry.text),
      text: relativizeHome(entry.text),
      aliases: aliasesFor(name, entry.text),
    };
  });

  const situationData: SituationData[] = situations.map(({ situation, ctx }) => ({
    situation,
    description: ctx.description,
    notRendered: ctx.notRendered,
    layers: ctx.layers.map((layer) => {
      const name = layerName(situation, layer.name);
      return {
        name,
        label: layer.name,
        source: relativizeHome(layer.source),
        loading: layer.loading,
        words: wordCount(layer.text),
        tokens: estimateTokens(layer.text),
        text: relativizeHome(layer.text),
        aliases: aliasesFor(name, layer.text),
      };
    }),
  }));

  const duplication = findDuplication(
    allFragments.map((f) => ({ name: f.name, text: f.text })),
  ).map((finding) => ({ ...finding, text: relativizeHome(finding.text) }));

  const fragmentIndex: FragmentIndexEntry[] = allFragments.map((fragment) => ({
    name: fragment.name,
    kind: fragment.kind,
    aliases: aliasesFor(fragment.name, fragment.text),
  }));

  const situationSizes: Record<string, SituationSize> = {};
  for (const { situation, ctx } of situations) {
    let alwaysWords = 0;
    let alwaysTokens = 0;
    let totalWords = 0;
    let totalTokens = 0;
    for (const layer of ctx.layers) {
      const words = wordCount(layer.text);
      const tokens = estimateTokens(layer.text);
      totalWords += words;
      totalTokens += tokens;
      if (layer.loading === "always") {
        alwaysWords += words;
        alwaysTokens += tokens;
      }
    }
    situationSizes[situation] = { alwaysWords, alwaysTokens, totalWords, totalTokens };
  }

  const fragmentSizes: LedgerLine["fragments"] = {};
  for (const fragment of allFragments) {
    fragmentSizes[fragment.name] = {
      words: wordCount(fragment.text),
      tokens: estimateTokens(fragment.text),
    };
  }

  return {
    data: {
      generatedAt,
      commit,
      box: relativizeHome(box),
      situations: situationData,
      inventory,
      duplication,
      fragmentIndex,
    },
    ledgerContent: { situations: situationSizes, fragments: fragmentSizes },
  };
}
