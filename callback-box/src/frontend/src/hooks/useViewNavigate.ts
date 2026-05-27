/**
 * Standard "navigate to a view URL" handler for {@link Markdown} / {@link FileView}.
 *
 * Context-less call sites (commit detail, card tree, etc.) want
 * the default behavior: push `/<box>/views/<path>?view=X&zoom` onto the
 * history. Surfaces that need different semantics (swap a sidebar pane,
 * keep the browse layout) should build their own handler instead of using
 * this hook.
 */

import { useCallback } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { serializeViewUrl, type NavigateHint, type ViewTarget } from "../lib/view-url";

export function useViewNavigate(): (target: ViewTarget, hint?: NavigateHint) => void {
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();
  return useCallback(
    (target: ViewTarget) => {
      navigate({ to: href(`/${boxSlug}/views/${serializeViewUrl(target)}`) });
    },
    [boxSlug, navigate],
  );
}
