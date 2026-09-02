import { useCallback, useMemo, useRef } from "react";
import type { ViewHistory } from "@core/views/types.js";
import { decideViewHistoryUpdate } from "@shared/view-state";
import type { ViewState } from "../lib/view-url";
import { toastError } from "../components/ui/toast-store";

const EMPTY_VIEW_STATE: ViewState = {};

export function useViewHistory(opts: {
  slug: string;
  state: ViewState | null | undefined;
  canPush: boolean;
  onChange?: (next: ViewState, method: "push" | "replace") => void;
}): ViewHistory {
  const { slug, state, canPush, onChange } = opts;
  const warnedReplaceOnly = useRef(false);
  const update = useCallback((next: ViewState, method: "push" | "replace") => {
    const decision = decideViewHistoryUpdate({ state: next, requested: method, canPush });
    if (decision === "rejected") {
      const message = `View "${slug}" supplied state that is not a JSON-safe object`;
      console.error(message);
      toastError(message);
      return "rejected" as const;
    }
    if (onChange === undefined) {
      console.error(`View "${slug}" has no state owner on this surface`);
      return "rejected" as const;
    }
    if (method === "push" && decision === "replace" && !warnedReplaceOnly.current) {
      warnedReplaceOnly.current = true;
      console.warn(`View "${slug}" requested pushState on a replace-only surface; replacing instead`);
    }
    onChange(next, decision);
    return decision === "push" ? "pushed" as const : "replaced" as const;
  }, [canPush, onChange, slug]);

  return useMemo(() => ({
    state: state ?? EMPTY_VIEW_STATE,
    canPush,
    pushState: (next) => update(next, "push"),
    replaceState: (next) => { update(next, "replace"); },
  }), [canPush, state, update]);
}
