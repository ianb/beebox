/**
 * Set document.title for the duration of the calling component's mount.
 *
 * Restores the previous title on unmount so navigation back to a page
 * without its own title doesn't leak the last one set.
 */

import { useEffect } from "react";

const APP_NAME = "Callback Box";

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} — ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
