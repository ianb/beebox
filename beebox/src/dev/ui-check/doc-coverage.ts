/**
 * The pure core of `pnpm ui-check`: does `frontend.md` name every export of
 * `components/ui/`, and does every component it names exist?
 */

/** A component or hook that only other `components/ui/` modules use. */
export interface UiInternal {
  name: string;
  /** The `components/ui/` file that imports it (relative to `components/ui/`). */
  reason: string;
}

export const UI_INTERNALS: readonly UiInternal[] = [
  { name: "FieldShell", reason: "fields/field.tsx" },
  { name: "FieldMessage", reason: "fields/checkbox.tsx" },
  { name: "RevealButton", reason: "fields/field.tsx" },
  { name: "useFieldInk", reason: "fields/checkbox.tsx" },
  { name: "MenuContext", reason: "menu-item.tsx" },
  { name: "useAnchoredLayer", reason: "Menu.tsx" },
];

/** Names the primitives section uses as `<Name>` that are not exports of `components/ui/`. */
export const EXTERNAL_PRIMITIVES: readonly string[] = ["Link"]; // TanStack Router's Link

export interface UiExport {
  name: string;
  /** Path relative to `components/ui/`. */
  file: string;
}

export interface UiImport {
  name: string;
  /** Path of the importing file relative to `src/frontend/src/components/`. */
  file: string;
}

export interface DocCoverageInput {
  exports: readonly UiExport[];
  doc: string;
  /** Imports of allow-listed names, from every frontend file that imports one of them from `components/ui/`. */
  internalImports?: readonly UiImport[];
  internals?: readonly UiInternal[];
}

const SECTION_HEADING = "## Frontend UI Primitives";

/** The primitives section: from its `##` heading to the next `##` heading. */
export function primitivesSection(doc: string): string | null {
  const start = doc.indexOf(`\n${SECTION_HEADING}\n`);
  if (start === -1) return null;
  const rest = doc.slice(start + 1 + SECTION_HEADING.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Identifiers the doc names as `<Name>` or in backticks. */
function namedIdentifiers(doc: string): Set<string> {
  return new Set([...doc.matchAll(/[<`]([A-Za-z][\dA-Za-z]*)/g)].flatMap((match) => (match[1] === undefined ? [] : [match[1]])));
}

/** One message per breach; empty when the docs and `ui/` agree. */
export function docCoverageProblems(input: DocCoverageInput): string[] {
  const internals = input.internals ?? UI_INTERNALS;
  const internalNames = new Set(internals.map((entry) => entry.name));
  const exported = new Set(input.exports.map((entry) => entry.name));
  const named = namedIdentifiers(input.doc);
  const problems: string[] = [];

  for (const entry of internals) {
    if (!exported.has(entry.name)) problems.push(`ui-check allow-list: ${entry.name} is not an export of components/ui/`);
    const importers = (input.internalImports ?? []).filter((use) => use.name === entry.name);
    for (const use of importers) {
      if (!use.file.startsWith("ui/")) {
        problems.push(`${entry.name} is ui-internal but components/${use.file} imports it; document it in frontend.md and drop it from the allow-list, or stop importing it`);
      }
    }
    if (!importers.some((use) => use.file === `ui/${entry.reason}`)) {
      problems.push(`ui-check allow-list: components/ui/${entry.reason} does not import ${entry.name}`);
    }
  }

  for (const entry of input.exports) {
    if (internalNames.has(entry.name) || named.has(entry.name)) continue;
    problems.push(`frontend.md does not name ${entry.name} (components/ui/${entry.file}); name it in backticks (\`<${entry.name}>\` for a component)`);
  }

  const section = primitivesSection(input.doc);
  if (section === null) return [...problems, `frontend.md has no "${SECTION_HEADING}" section`];
  for (const match of section.matchAll(/`<([A-Z][\dA-Za-z]*)/g)) {
    const name = match[1];
    if (name === undefined || exported.has(name) || EXTERNAL_PRIMITIVES.includes(name)) continue;
    problems.push(`frontend.md names <${name}> in its primitives section, but components/ui/ exports no ${name}`);
  }
  return [...new Set(problems)];
}
