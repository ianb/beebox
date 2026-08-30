/**
 * Knip compiler for doctest markdown.
 *
 * Doctests are the suite: `test/**\/*.doctest.md` fences import from `src/`
 * and exercise it. Knip parses TypeScript, not markdown, so without this every
 * export whose only consumer is a doctest reads as dead — and the `exports`
 * check would happily delete live code.
 *
 * Knip only needs the module graph's edges, not runnable code, so this lifts
 * the import statements out of the TS fences and drops everything else. Fence
 * bodies are snippets, not programs (`await using` mid-fence, bare expressions
 * with `=> value` assertions after them), and handing them to the TS parser
 * whole crashes it.
 *
 * Doctests reach `src/` two ways, and both have to survive the trip:
 *   - static:  `import { loadCalendarState } from "../../src/...js"`
 *   - dynamic: `const { loadCalendarState } = await import("../../src/...js")`
 * The dynamic form is rewritten to the static one so knip sees the named
 * bindings rather than an opaque module reference.
 */

/** Fences whose bodies are TS/JS. A `bash` fence has no imports worth reading. */
const CODE_FENCE = /^```(?:ts|tsx|typescript|js|jsx|javascript)\b[^\n]*\n([\S\s]*?)^```/gm;

/** `import ... from "spec"`, including the multi-line named form. */
const STATIC_IMPORT = /^[\t ]*import\s[\S\s]*?\sfrom\s*(["'])([^"']+)\1;?/gm;

/** `const { a, b: c } = await import("spec")` */
const DYNAMIC_NAMED = /(?:const|let|var)\s*{([^}]*)}\s*=\s*await\s+import\(\s*(["'])([^"']+)\2\s*\)/g;

/** `const ns = await import("spec")` */
const DYNAMIC_NAMESPACE =
  /(?:const|let|var)\s+([$A-Z_a-z][\w$]*)\s*=\s*await\s+import\(\s*(["'])([^"']+)\2\s*\)/g;

/** `a, b: c` (a destructuring pattern) → `a, b as c` (an import clause). */
function bindingsToImportClause(pattern: string): string {
  return pattern
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, alias] = part.split(":").map((s) => s.trim());
      return alias ? `${name} as ${alias}` : name;
    })
    .join(", ");
}

/**
 * Return the import statements a doctest makes, as a standalone TS module.
 * Anything that isn't an import — every assertion, every fixture — is dropped.
 */
export function doctestImports(text: string): string {
  const out: string[] = [];
  for (const fence of text.matchAll(CODE_FENCE)) {
    const body = fence[1];
    // Collapse the multi-line named form onto one line, so every statement this
    // returns is one line — the shape the corpus check in the doctest relies on.
    for (const m of body.matchAll(STATIC_IMPORT)) out.push(m[0].trim().replace(/\s+/g, " "));
    for (const m of body.matchAll(DYNAMIC_NAMED)) {
      const clause = bindingsToImportClause(m[1]);
      if (clause) out.push(`import { ${clause} } from ${m[2]}${m[3]}${m[2]};`);
    }
    for (const m of body.matchAll(DYNAMIC_NAMESPACE)) {
      out.push(`import * as ${m[1]} from ${m[2]}${m[3]}${m[2]};`);
    }
  }
  return out.join("\n");
}
