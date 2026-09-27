/**
 * Template registry core — the in-memory map of template definitions and the
 * accessors used to register and look them up. Imports `templateGroups` (the
 * built-in template groups, plain data) from `templates.ts` and registers
 * every member at this module's own load, so importing any lookup below
 * (`getTemplate`, `getAllTemplates`, ...) is what loads the built-ins — no
 * consumer needs a bare side-effect `import "./templates.js"`. `templates.ts`
 * and the built-in template group files (`templates/*.ts`) depend on
 * `templates-shape.ts`, not this module, so this is a one-directional value
 * import, not a cycle; `TemplateDefinition` is re-exported below for this
 * module's existing consumers.
 */

import { invariant } from "./shared/invariant.js";
import { type TemplateDefinition } from "./templates-shape.js";
import { templateGroups } from "./templates.js";

export type { TemplateDefinition } from "./templates-shape.js";

/**
 * Owner sentinel for the process's built-in templates. A box owner is always
 * its absolute boxRoot, so this can never collide with one.
 */
const BUILTIN_OWNER = "builtin";

interface Registration {
  owner: string;
  def: TemplateDefinition;
}

/**
 * Template registry mapping each name to an owner-stack. The *effective*
 * definition for a name is the last registration; this lets a box-local
 * template shadow a built-in of the same name and, when that box reloads and
 * its registrations are dropped, restores the shadowed built-in instead of
 * losing the name entirely. The server hosts many boxes in one process, so
 * ownership (not a blind `set`/`delete` by name) is what keeps one box's
 * reload from clobbering another box's same-named template.
 */
const registrations = new Map<string, Registration[]>();

for (const group of templateGroups.list) {
  for (const def of group) register(def, BUILTIN_OWNER);
}

function register(def: TemplateDefinition, owner: string): void {
  const list = registrations.get(def.name) ?? [];
  // Re-registering under the same owner replaces that owner's prior entry and
  // moves it to the top (idempotent edit), leaving other owners' entries intact.
  const next = list.filter((r) => r.owner !== owner);
  next.push({ owner, def });
  registrations.set(def.name, next);
}

function effective(list: Registration[]): TemplateDefinition {
  const last = list.at(-1);
  // `register()` never stores an empty array — every list in the map has at
  // least the registration that created it.
  invariant(last !== undefined, "templates-registry: registration list is empty");
  return last.def;
}

/**
 * Register a box-local template owned by `owner` (its boxRoot). Replaceable as
 * a set via `unregisterBoxTemplates(owner)` on reload.
 */
export function registerBoxTemplate(definition: TemplateDefinition, owner: string): void {
  register(definition, owner);
}

/**
 * Drop every template registered by `owner` (a box reload), restoring any
 * built-in or other-box template a dropped one had shadowed.
 */
export function unregisterBoxTemplates(owner: string): void {
  for (const [name, list] of registrations) {
    const next = list.filter((r) => r.owner !== owner);
    if (next.length === 0) registrations.delete(name);
    else registrations.set(name, next);
  }
}

/**
 * Get a template by name.
 *
 * Note: lookup is process-global (no boxRoot). Registration is owner-scoped, so
 * a box reload won't clobber another box's templates, but if two hosted boxes
 * define the same template name the globally-effective (last-registered) one
 * wins. In practice the heavy consumers (`bbx create`, `bbx init`) are fresh
 * single-box processes, so this only matters to a long-lived multi-box server —
 * a separate boxRoot-threading change if it ever does.
 */
export function getTemplate(name: string): TemplateDefinition | undefined {
  const list = registrations.get(name);
  return list ? effective(list) : undefined;
}

/**
 * Get all registered template names.
 */
export function getTemplateNames(): string[] {
  return Array.from(registrations.keys());
}

/**
 * Get all template definitions.
 */
export function getAllTemplates(): TemplateDefinition[] {
  return Array.from(registrations.values()).map(effective);
}

/**
 * The templates the engine itself registered — never a box's. For docs that
 * describe the package rather than a box (the package docs directory), where
 * ambient registry state would leak one box's templates into every box's docs.
 */
export function getBuiltinTemplates(): TemplateDefinition[] {
  const out: TemplateDefinition[] = [];
  for (const list of registrations.values()) {
    const builtin = list.find((r) => r.owner === BUILTIN_OWNER);
    if (builtin) out.push(builtin.def);
  }
  return out;
}

/**
 * The templates a box registered (its box-local `src/schemas/*.ts` `template`
 * exports), including any that shadow a built-in. For that box's own agent
 * guide, which lists them beside the package's built-in reference.
 */
export function getTemplatesOwnedBy(owner: string): TemplateDefinition[] {
  const out: TemplateDefinition[] = [];
  for (const list of registrations.values()) {
    const own = list.find((r) => r.owner === owner);
    if (own) out.push(own.def);
  }
  return out;
}

/**
 * Find templates that can create a given card type.
 */
export function getTemplatesForCardType(cardType: string): TemplateDefinition[] {
  return getAllTemplates().filter((t) => t.cardTypes.includes(cardType));
}

/**
 * Get the default template for a given card type.
 * Returns the template whose defaultForTypes includes this card type.
 */
export function getDefaultTemplate(cardType: string): TemplateDefinition | undefined {
  return getAllTemplates().find((t) => t.defaultForTypes?.includes(cardType));
}
