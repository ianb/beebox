/**
 * The `beebox/schema` export: the validator dependencies a box-local
 * card schema needs, re-exported so a box's only dependency is beebox
 * and its zod/yaml versions are pinned to what the engine validates with.
 *
 * Box schema files import `z` (and occasionally yaml helpers) from here
 * instead of declaring their own zod/yaml dependencies:
 *
 *   import { z } from "beebox/schema";
 *   import { body, cardSchema } from "beebox/cards";
 */
export { z } from "zod";
export { parse as parseYaml, stringify as stringifyYaml } from "yaml";
