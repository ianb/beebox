import { useSyncExternalStore } from "react";

function subscribeViewport(onChange: () => void) {
  const media = window.matchMedia("(max-width: 767px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useMobileChatViewport() {
  return useSyncExternalStore(subscribeViewport, () => window.matchMedia("(max-width: 767px)").matches, () => false);
}
