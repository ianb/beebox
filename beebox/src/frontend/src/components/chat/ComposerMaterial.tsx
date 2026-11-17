import type { ReactNode } from "react";
import { MaterialContext } from "../ui/material";
import { cn } from "../../lib/cn";

/** The composer surface owns the ink for notices, activity and transparent controls. */
export function ComposerMaterial({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <MaterialContext.Provider value>
    <div id={id} className={cn("bbx-composer-material", className)}>{children}</div>
  </MaterialContext.Provider>;
}
