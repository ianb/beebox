import { useCallback } from "react";

interface BrowseMoveOptions {
  search?: Record<string, unknown>;
  replace?: boolean;
}

export function useMovedCardNavigation({
  onNavigate,
  search,
}: {
  onNavigate: (path: string, options?: BrowseMoveOptions) => void;
  search: Record<string, unknown>;
}): (path: string) => void {
  return useCallback((path: string) => {
    onNavigate(path, { search, replace: true });
  }, [onNavigate, search]);
}
