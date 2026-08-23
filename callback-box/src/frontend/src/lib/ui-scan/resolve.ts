/**
 * The other direction: from a `control:` address back to a live element.
 *
 * The address *is* an HTML `id`, so resolution is one `getElementById` call —
 * browser-guaranteed, with no selector escaping (hence kebab-case and not dots:
 * `querySelector("#a.b")` parses as id `a` plus class `b`).
 *
 * Fails closed, like `resolveRefPath` (`src/shared/ref-path.ts`): an id that is
 * not a well-formed `cb-` address is rejected without touching the document, and
 * a well-formed one that matches nothing is a named failure the caller renders
 * as broken. A *duplicate* cannot be detected here — `getElementById` returns
 * the first in document order — which is why uniqueness is enforced upstream by
 * axe in the tours, with the scan reporting duplicates as a second line.
 */

// Raw relative (not `@shared/…`): loaded outside Vite by its own doctest, which
// runs under the root tsconfig where the alias does not resolve.
import { err, ok, type Result } from "../../../../shared/result.js";

/** The namespace that separates published addresses from internal a11y wiring. */
export const CONTROL_ID_PREFIX = "cb-";

/** `cb-` plus kebab-case segments — nothing that would need escaping. */
const CONTROL_ID_PATTERN = /^cb(?:-[\da-z]+)+$/;

/** Whether an id is a control address at all, before any lookup. */
export function isControlAddress(id: string): boolean {
  return CONTROL_ID_PATTERN.test(id);
}

/** Why an address did not resolve. Callers branch on this to write the tooltip. */
export type ResolveFailure = "bad-id" | "not-found";

/** The document surface `resolveControl` needs — the real `Document` satisfies it. */
export interface ElementLookup<E> {
  getElementById: (id: string) => E | null;
}

/**
 * The element this address names, or why it does not name one.
 *
 * Generic in the element type so the live `document` resolves to `HTMLElement`
 * while a test resolves to a fixture, with no cast at either call site.
 */
export function resolveControl<E>(id: string, lookup: ElementLookup<E>): Result<E, ResolveFailure> {
  if (!isControlAddress(id)) return err("bad-id");
  const element = lookup.getElementById(id);
  return element === null ? err("not-found") : ok(element);
}
