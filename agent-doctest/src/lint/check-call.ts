/**
 * Recognizes a call to one of tap's check methods (`t.check`,
 * `t.checkText`, `t.checkThrows`). The rules match the call's shape only, so
 * they need no type information.
 */

import type { CallExpression, Node } from "estree";

const CHECK_METHODS = new Set(["check", "checkText", "checkThrows"]);
/** The names a test's tap object goes by: the callback parameter, or `tap` when setup declares `t`. */
const TEST_OBJECTS = new Set(["t", "tap"]);

/** The method name when `node` is a call like `t.check(...)`, or null. */
export function checkMethod(node: Node): string | null {
  if (node.type !== "CallExpression") return null;
  const callee = (node as CallExpression).callee;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.object.type !== "Identifier" || !TEST_OBJECTS.has(callee.object.name)) return null;
  if (callee.property.type !== "Identifier" || !CHECK_METHODS.has(callee.property.name)) return null;
  return callee.property.name;
}
