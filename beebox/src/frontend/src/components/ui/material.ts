import { createContext, useContext } from "react";

/**
 * Whether the nearest `Card` paints the enclosing card theme's material
 * (`Card material`) or its own app surface. Text primitives read it, so a
 * panel that takes the material takes its ink too, and a white app panel
 * inside a dark card keeps app ink.
 */
export const MaterialContext = createContext(false);

/** An explicit `material` prop wins; otherwise follow the nearest Card. */
export function useMaterial(explicit: boolean | undefined): boolean {
  const inherited = useContext(MaterialContext);
  return explicit ?? inherited;
}
