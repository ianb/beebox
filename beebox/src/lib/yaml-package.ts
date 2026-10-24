/**
 * The `yaml` package, loaded on first use.
 *
 * Loading `yaml` costs about 12 ms, and most verbs never call it: card reads
 * parse with js-yaml (`read-yaml.ts`), and `yaml` is needed only to write or
 * edit YAML, or when js-yaml could read a text differently. A static import
 * anywhere on a verb's path loads it at start, so code outside `src/dev/` and
 * `src/scripts/migrate/` imports `yaml`'s functions from here instead. The
 * exports keep `yaml`'s names and types; type-only imports of `yaml` are
 * erased and stay as they are. `test/lib/yaml-package.test.ts` checks that a
 * card read does not load it (`docs/plans/yaml-lazy-load.md`).
 */

import { createRequire } from "node:module";
import type * as Yaml from "yaml";

type YamlPackage = typeof Yaml;
type LazyFunctions = Pick<YamlPackage, "parse" | "parseDocument" | "stringify" | "isMap" | "isSeq" | "isScalar">;
type LazyFunction<K extends keyof LazyFunctions> = LazyFunctions[K];

// `yaml` ships CommonJS for Node, so it can be required synchronously from
// the synchronous functions that call it.
const requireYaml = createRequire(import.meta.url);
let loaded: YamlPackage | undefined;

function yaml(): YamlPackage {
  // eslint-disable-next-line no-restricted-syntax -- `require` returns `any`; the module is `yaml`, whose type the `import type` above names
  loaded ??= requireYaml("yaml") as YamlPackage;
  return loaded;
}

/** `yaml`'s function `name`, with its overloads, loading `yaml` when called. */
function lazy<K extends keyof LazyFunctions>(name: K): LazyFunction<K> {
  // eslint-disable-next-line no-restricted-syntax -- the wrapper passes its arguments to `yaml`'s function unchanged, so it has that function's type; TypeScript cannot infer an overloaded type for it
  return ((...args: unknown[]): unknown => Reflect.apply(yaml()[name], undefined, args)) as LazyFunction<K>;
}

export const parse = lazy("parse");
export const parseDocument = lazy("parseDocument");
export const stringify = lazy("stringify");
export const isMap = lazy("isMap");
export const isSeq = lazy("isSeq");
export const isScalar = lazy("isScalar");

/** `new Document(value)`: a document to edit and render. */
export function createDocument(value?: unknown): Yaml.Document {
  return new (yaml().Document)(value);
}

/** Whether `error` is `yaml`'s parse error. It cannot be before `yaml` has loaded. */
export function isYamlParseError(error: unknown): error is Yaml.YAMLParseError {
  return loaded !== undefined && error instanceof loaded.YAMLParseError;
}
