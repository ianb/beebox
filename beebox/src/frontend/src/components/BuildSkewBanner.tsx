/**
 * Keeps a tab current across deploys (`lib/build-skew/store.ts`): listens to
 * `build.watch` and to the page being shown, reloads a stale tab when it is
 * shown again and nothing would be lost, and otherwise shows a dismissible
 * "new version" banner. Mounted once in the product shell.
 *
 * Shown means the document is visible and, in the iOS app, its native box
 * screen does not cover the page (`window.beeboxShellShown`, the
 * `beebox:shell-shown` event; see `AppNav/PresenceHeads.tsx`).
 */

import { useEffect, useSyncExternalStore } from "react";
import { FRONTEND_BUILD_META_NAME } from "@shared/frontend-build";
import { trpc } from "../lib/trpc/client";
import { createBuildSkewStore, type BuildSkewStore } from "../lib/build-skew/store";
import { activeReloadBlockers } from "../lib/reload-blockers";
import { isNativeShell } from "./chat/native-post";
import { INFO_BANNER_CLASSES } from "./notifications/NotificationNotice";
import { Button } from "./ui/Button";
import { CloseButton } from "./ui/CloseButton";
import { Row } from "./ui/Row";
import { Text } from "./ui/Text";

function pageShown(): boolean {
  if (document.visibilityState !== "visible") return false;
  return !isNativeShell() || window.beeboxShellShown !== false;
}

let singleton: BuildSkewStore | null = null;

function buildSkewStore(): BuildSkewStore {
  singleton ??= createBuildSkewStore({
    clientBuild: document.querySelector(`meta[name="${FRONTEND_BUILD_META_NAME}"]`)?.getAttribute("content") ?? null,
    now: () => Date.now(),
    isVisible: pageShown,
    blockers: activeReloadBlockers,
    storage: () => window.sessionStorage,
    reload: () => window.location.reload(),
    warn: (message) => console.warn(message),
  });
  return singleton;
}

export function BuildSkewBanner() {
  const store = buildSkewStore();
  trpc.build.watch.useSubscription(undefined, { onData: (frame) => store.serverBuild(frame.frontend) });

  useEffect(() => {
    let wasShown = pageShown();
    const handleShownChange = () => {
      const shown = pageShown();
      if (shown && !wasShown) store.shown();
      wasShown = shown;
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) store.shown();
    };
    const handleInput = () => store.touched();
    document.addEventListener("visibilitychange", handleShownChange);
    window.addEventListener("beebox:shell-shown", handleShownChange);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("pointerdown", handleInput, { capture: true });
    window.addEventListener("keydown", handleInput, { capture: true });
    return () => {
      document.removeEventListener("visibilitychange", handleShownChange);
      window.removeEventListener("beebox:shell-shown", handleShownChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("pointerdown", handleInput, { capture: true });
      window.removeEventListener("keydown", handleInput, { capture: true });
    };
  }, [store]);

  const { banner } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const handleReload = () => window.location.reload();
  const handleDismiss = store.dismiss;
  return (
    <div role="status" aria-live="polite" className={banner ? "px-3 pt-2" : undefined}>
      {banner ? (
        <Row gap="sm" align="center" className={INFO_BANNER_CLASSES}>
          <Text size="sm" className="flex-1 min-w-0">A new version of Bee Box is available.</Text>
          <Button id="bbx-build-skew-reload" size="sm" intent="primary" onClick={handleReload}>Reload</Button>
          <CloseButton id="bbx-build-skew-dismiss" size="sm" label="Dismiss new version notice" onClick={handleDismiss} />
        </Row>
      ) : null}
    </div>
  );
}
