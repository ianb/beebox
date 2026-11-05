import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface PointSelectionState {
  active: boolean;
  setActive: (active: boolean) => void;
}

const PointSelectionContext = createContext<PointSelectionState | null>(null);

/** One ephemeral selection mode for the box's bar, cards, and transcript. */
export function PointSelectionProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const value = useMemo(() => ({ active, setActive }), [active]);
  return <PointSelectionContext.Provider value={value}>{children}</PointSelectionContext.Provider>;
}

export function usePointSelection(): PointSelectionState | null {
  return useContext(PointSelectionContext);
}
