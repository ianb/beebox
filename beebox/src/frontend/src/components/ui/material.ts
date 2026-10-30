import { createContext, useContext } from "react";

/**
 * Whether the nearest surface paints a material — the enclosing card theme's
 * (`Card material`), a chat material (reply, pending, meta roots) or the
 * neutral file desk, whose ink the system theme sets — or its own app surface. Text primitives read it,
 * so a panel that takes the material takes its ink too, and a white app panel
 * (a non-material `Card`, a `Dropdown` menu) inside one keeps app ink.
 */
export const MaterialContext = createContext(false);

/** An explicit `material` prop wins; otherwise follow the nearest Card. */
export function useMaterial(explicit: boolean | undefined): boolean {
  const inherited = useContext(MaterialContext);
  return explicit ?? inherited;
}
