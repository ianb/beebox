/**
 * Finding 7 (side-effect-registration): the check backing rule 4's "nothing
 * else constructs the list" — a module that calls, at import, a registration
 * function it imported from elsewhere in this package.
 */
import type { Finding, ModuleFile, PackageLayout } from "../../../model.js";
import { modules } from "../../../graph.js";

const REGISTER_CALL = /(^|\.)register[A-Z]/;

/** True when `callee`'s root identifier (`a` for `a.b.registerX`) is bound by an import from
 * another file inside this package (not an external package, and not a global or a same-file
 * function, which are bound by no import at all). */
function isInternalRegistrationCallee(module: ModuleFile, callee: string): boolean {
  const dot = callee.indexOf(".");
  const root = dot === -1 ? callee : callee.slice(0, dot);
  return module.imports.some((edge) => !edge.external && edge.names.includes(root));
}

/** A module that calls, at import, a registration function it imported from elsewhere in this
 * package. A global (e.g. the AudioWorklet `registerProcessor`) or a same-file function is
 * bound by no import, not self-registration. */
export function sideEffectRegistrationFindings(layout: PackageLayout): Finding[] {
  const findings: Finding[] = [];
  for (const module of modules(layout)) {
    const registersImportedFunction = module.topLevelCalls.some(
      (callee) => REGISTER_CALL.test(callee) && isInternalRegistrationCallee(module, callee),
    );
    if (!registersImportedFunction) continue;
    findings.push({
      rule: "side-effect-registration",
      path: module.path,
      message: "registers at import; list it in a defineRegistry registry instead",
    });
  }
  return findings;
}
