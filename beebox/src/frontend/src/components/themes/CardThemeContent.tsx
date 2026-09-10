import type { ReactNode } from "react";

export function CardThemeContent({ children }: { children: ReactNode }) {
  return <div className="bbx-card-content">{children}</div>;
}
