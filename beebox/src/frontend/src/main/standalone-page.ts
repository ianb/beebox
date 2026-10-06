import { useMatches } from "@tanstack/react-router";

/**
 * Whether the page renders without the box conversation shell
 * (`ProductLayout`). Decided by the matched route's own `staticData.standalone`,
 * never by its path: the box screen must not construct the chat
 * (docs/plans/box-screen.md, track 2).
 */
export function useStandalonePage(): boolean {
  return useMatches({ select: (matches) => matches.some((match) => match.staticData.standalone === true) });
}
